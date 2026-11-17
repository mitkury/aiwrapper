<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		Play,
		Square,
		Mic,
		MicOff,
		Volume2,
		AlertCircle,
		Video,
		MessageSquare,
		Send,
		Settings2,
		Images,
		List,
		ChevronDown
	} from 'lucide-svelte';
	import RoomSimulator from './RoomSimulator.svelte';
	import FrameReview from './FrameReview.svelte';
	import TurnTimelineView from './TurnTimeline.svelte';
	import {
		retainRequest,
		attachProviderRequest,
		cameraRequest,
		readableRequest,
		type RequestSnapshot
	} from '$lib/realtime/request-snapshot';
	import { TurnTimeline, type TurnTiming } from '$lib/realtime/turn-timeline';
	import { providerConfigs, type ProviderId } from '$lib/provider-config';
	import { resampleToPcm } from '$lib/realtime/pcm';
	import { CascadePlayer, PlaybackQueueFull, type Cursor } from '$lib/realtime/cascade-player';
	let timelineView = $state<{ inspect: (turnId: number) => void }>();
	let { live = false, simulator = false }: { live?: boolean; simulator?: boolean } = $props();
	let liveDefaults: Record<string, { model: string; voice: string }> = {};
	let inputRate = 24000,
		responseIndex = 0;
	let liveCursor: Cursor | undefined;
	let ready = $state(false);
	let instructions = $state('');
	let offline = $state(true),
		provider = $state<ProviderId>('anthropic'),
		model = $state(''),
		sttModel = $state('flux-general-en');
	let tts = $state('elevenlabs'),
		ttsModel = $state('eleven_flash_v2_5'),
		voice = $state('CwhRBWXzGAHq8TQ4Fs17');
	let muted = $state(false);
	let micStatus = $state('Waiting for microphone'),
		micLevel = $state(0);
	let phase = $state('Disconnected'),
		error = $state(''),
		id = $state(''),
		text = $state(''),
		mic = $state(true);
	let cameraSource = $state('off');
	let settingsOpen = $state(false);
	let settingsPanel = $state<HTMLDetailsElement>();
	let conversationFeed = $state<HTMLDivElement>();
	let followConversation = $state(true);
	let playing = $state(false);
	let playbackTimer: ReturnType<typeof setInterval> | undefined;
	$effect(() => {
		const latest = transcripts.at(-1)?.text;
		if (latest && followConversation)
			void tick().then(() => conversationFeed?.scrollTo({ top: conversationFeed.scrollHeight }));
	});
	const camera = $derived(cameraSource !== 'off');
	let cameraContext = $state('recent');
	let roomCanvas = $state<HTMLCanvasElement>();
	let frameId = $state(0),
		capturing = false;
	let requestSnapshots = $state.raw<RequestSnapshot[]>([]);
	let frameRequestIndex = $state(0),
		droppedRequests = $state(0);
	const frameRequests = $derived(
		requestSnapshots.flatMap((r) => {
			const frames = cameraRequest(r);
			return frames ? [frames] : [];
		})
	);
	let configured = $state<Record<string, { configured: boolean; model: string }>>({});
	let keys = $state({ deepgram: false, elevenlabs: false, openai: false });
	let entries = $state<{ time: string; label: string; detail: string }[]>([]);
	type PlaybackCut = {
		itemId: string;
		playedMs: number;
		generatedMs: number;
		retainedText: string;
		unplayedText: string;
		accuracy: 'provider-timed' | 'estimated' | 'segment-boundary';
		playbackConfirmed: boolean;
	};
	let transcripts = $state<
		{ id: string; input: boolean; text: string; turnId?: number; cut?: PlaybackCut }[]
	>([]);
	let selected = $state<number | null>(null);
	let video = $state<HTMLVideoElement>();
	let connection: AbortController | undefined,
		player: CascadePlayer | undefined,
		media: MediaStream | undefined,
		capture: AudioContext | undefined,
		processor: ScriptProcessorNode | undefined;
	let cameraTimer: ReturnType<typeof setInterval> | undefined;
	let micTimer: ReturnType<typeof setInterval> | undefined;
	let tail = Promise.resolve(),
		queued = 0,
		acceptAudio = false,
		started = 0;
	const connected = $derived(Boolean(id));
	let turns = $state.raw<TurnTiming[]>([]);
	let timeline = new TurnTimeline((value) => (turns = value));
	const elapsed = () => performance.now() - started;
	function log(label: string, detail: unknown) {
		entries = [
			...entries.slice(-299),
			{
				time: ((performance.now() - started) / 1000).toFixed(2),
				label,
				detail:
					label === 'request' || label === 'provider-request'
						? readableRequest(detail)
						: JSON.stringify(detail, null, 2)
			}
		];
		while (
			entries.length > 1 &&
			entries.reduce((size, e) => size + e.detail.length, 0) > 8 * 1024 * 1024
		)
			entries = entries.slice(1);
	}
	function fail(e: unknown) {
		error =
			e instanceof Error && e.name === 'NotAllowedError'
				? 'Device access was denied. Allow microphone or camera access in your browser’s site settings, then start the session again.'
				: e instanceof Error
					? e.message
					: String(e);
		log('error', { message: error });
		void disconnect();
	}
	async function command(value: unknown) {
		if (!id) return;
		if (++queued > 32) {
			queued--;
			throw new Error('Browser input queue overflow');
		}
		const target = id;
		const task = tail.then(async () => {
			const response = await fetch(`/api/cascade/${target}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(value)
			});
			if (!response.ok) throw new Error((await response.json()).error || 'Input failed');
		});
		tail = task.catch(() => {});
		try {
			await task;
		} finally {
			queued--;
		}
	}
	function event(packet: Record<string, any>) {
		if (!id) return;
		if (packet.type === 'error') {
			fail(packet.message);
			return;
		}
		if (packet.type !== 'model') {
			log(packet.type, packet);
			return;
		}
		const e = packet.event;
		const at = elapsed();
		if (!live) {
			if (e.type === 'speech-started') timeline.begin('speech', at, e.id);
			if (e.type === 'transcript' && e.text) {
				if (e.input) timeline.input(e.id, e.text, e.final_result, at);
				else timeline.mark(e.id, 'text', at);
			}
			if (e.type === 'response-ended') timeline.mark(undefined, 'modelEnd', at);
		}
		if (e.type === 'audio') {
			if (acceptAudio) {
				const item = e.item_id || `live-${responseIndex}`;
				if (!live && e.frame.samples.length) timeline.mark(item, 'audio', at);
				const index = e.content_index ?? 0;
				if (live && e.item_id && (liveCursor?.item !== item || liveCursor?.index !== index))
					liveCursor = { type: 'played', item, index, ms: 0 };
				try {
					player?.enqueue(item, index, e.frame.samples, e.frame.sampleRate);
				} catch (e) {
					if (!(e instanceof PlaybackQueueFull)) throw e;
					error = e.message;
					log('playback-limit', { message: error });
					void stopReply().catch(fail);
				}
			}
			return;
		}
		if (e.type === 'response-started') {
			acceptAudio = true;
			phase = 'Responding';
			responseIndex++;
		}
		if (e.type === 'interrupted') {
			acceptAudio = false;
			clearPlayback();
			if (!live) timeline.stop(at, false);
			phase = 'Listening';
		}
		if (live && e.type === 'response-ended') phase = 'Listening';
		if (e.type === 'closed') {
			fail(e.reason || 'Provider closed the live session');
			return;
		}
		if (e.type === 'transcription-failed') log('error', e.error);
		if (e.type === 'transcript') {
			if (!e.text) return;
			const key = `${e.input ? 'in' : 'out'}:${e.id ?? entries.length}`;
			const previous = transcripts.findIndex((t) => t.id === key);
			const value = {
				id: key,
				input: e.input,
				text: e.text,
				turnId: e.input
					? (turns.find((t) => e.id && t.inputId === e.id) ?? turns.at(-1))?.id
					: undefined
			};
			if (previous < 0) transcripts = [...transcripts.slice(-99), value];
			else transcripts[previous] = value;
			if (!e.final_result) return;
		}
		if (e.type === 'provider-state') {
			if (!live) {
				const state = e.state;
				if (state.kind === 'request')
					timeline.request(state.itemId, at, state.camera?.frames.length ?? 0);
				if (state.kind === 'tts-input') timeline.mark(state.itemId, 'tts', at);
				if (state.kind === 'synthesis-complete') timeline.mark(state.itemId, 'synthesisEnd', at);
			}
			if (!live && e.state.kind === 'playback-stop-requested') {
				// clear() queues final cursors before the acknowledgement. The
				// Rust runtime waits for it before constructing the next request.
				clearPlayback();
				void command({ type: 'playback-stopped', item: e.state.itemId }).catch(fail);
			}
			if (!live && e.state.kind === 'playback-cut') {
				const cut: PlaybackCut = e.state.cut;
				const row = transcripts.find((t) => t.id === `out:${cut.itemId}`);
				if (row) row.cut = cut;
			}
			if (!live && e.state.kind === 'request') {
				const retained = retainRequest(requestSnapshots, e.state, at);
				requestSnapshots = retained.requests;
				droppedRequests += retained.dropped;
				frameRequestIndex = Math.max(0, frameRequests.length - 1);
			}
			if (!live && e.state.kind === 'provider-request') {
				const retained = attachProviderRequest(requestSnapshots, e.state.itemId, e.state.request);
				requestSnapshots = retained.requests;
				droppedRequests += retained.dropped;
				frameRequestIndex = Math.min(frameRequestIndex, Math.max(0, frameRequests.length - 1));
			}
			if (e.state.kind === 'connected') {
				phase = 'Listening';
				inputRate = e.state.inputSampleRate || 24000;
				const sessionId = id;
				startMedia().catch((e) => {
					if (id === sessionId) fail(e);
				});
			}
			if (e.state.kind === 'synthesis-complete') phase = 'Listening';
			log(e.state.kind || 'provider-state', e.state);
			return;
		}
		log(e.type, e);
	}
	async function connect() {
		if (!ready || phase !== 'Disconnected') return;
		const sessionInstructions = instructions;
		error = '';
		micStatus = 'Waiting for microphone';
		micLevel = 0;
		entries = [];
		turns = [];
		timeline = new TurnTimeline((value) => (turns = value));
		requestSnapshots = [];
		frameRequestIndex = 0;
		droppedRequests = 0;
		frameId = 0;
		transcripts = [];
		followConversation = true;
		muted = false;
		selected = null;
		started = performance.now();
		phase = 'Connecting';
		connection = new AbortController();
		const current = connection;
		try {
			player = new CascadePlayer(
				(cursor) => {
					if (!live) command(cursor).catch(fail);
					else if (liveCursor?.item === cursor.item && liveCursor.index === cursor.index)
						liveCursor = cursor;
				},
				(moment) => {
					if (!live) timeline.playback(moment.item, moment.kind, moment.at - started);
				}
			);
			await player.resume();
			if (current.signal.aborted || connection !== current) return;
			playbackTimer = setInterval(() => {
				player?.poll();
				playing = Boolean(player && player.bufferedSeconds > 0);
			}, 100);
			const response = await fetch('/api/cascade', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					offline,
					live,
					microphone: mic,
					instructions: sessionInstructions,
					cameraContext,
					provider,
					model,
					sttModel,
					tts,
					ttsModel,
					voice
				}),
				signal: current.signal
			});
			if (current.signal.aborted || connection !== current) return;
			if (!response.ok) throw new Error((await response.json()).error);
			id = response.headers.get('X-Session-Id') || '';
			const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
			let pending = '';
			while (true) {
				const { value, done } = await reader.read();
				if (done || current.signal.aborted || connection !== current) break;
				pending += value;
				let end;
				while ((end = pending.indexOf('\n')) >= 0) {
					const line = pending.slice(0, end);
					pending = pending.slice(end + 1);
					if (line) event(JSON.parse(line));
				}
				if (pending.length > 8 * 1024 * 1024) throw new Error('Runtime event exceeded 8 MiB');
			}
			if (id && connection === current) await disconnect();
		} catch (e) {
			if (!current.signal.aborted && connection === current) fail(e);
		}
	}
	async function startMedia() {
		if ((!mic || offline) && !camera) return;
		const sessionId = id;
		const acquired =
			(mic && !offline) || cameraSource === 'webcam'
				? await navigator.mediaDevices.getUserMedia({
						audio:
							mic && !offline
								? { channelCount: 1, echoCancellation: true, noiseSuppression: true }
								: false,
						video:
							cameraSource === 'webcam' ? { width: { ideal: 640 }, height: { ideal: 360 } } : false
					})
				: undefined;
		if (!id || id !== sessionId) {
			acquired?.getTracks().forEach((t) => t.stop());
			return;
		}
		media = acquired;
		if (mic && !offline) {
			const track = media!.getAudioTracks()[0];
			const settings = track.getSettings();
			log('microphone-settings', {
				echoCancellation: settings.echoCancellation ?? 'not reported',
				noiseSuppression: settings.noiseSuppression ?? 'not reported',
				autoGainControl: settings.autoGainControl ?? 'not reported',
				sampleRate: settings.sampleRate,
				channelCount: settings.channelCount
			});
			muted = false;
			micStatus = 'Waiting for microphone';
			track.onended = () => {
				if (id === sessionId)
					fail('Microphone disconnected. Check the input device and reconnect.');
			};
			capture = new AudioContext();
			await capture.resume();
			if (id !== sessionId) return;
			let lastCaptured = performance.now(),
				lastSent = lastCaptured,
				capturedSamples = 0,
				sentSamples = 0;
			micTimer = setInterval(() => {
				const now = performance.now();
				let status = 'Microphone active · audio sent';
				if (muted) status = 'Microphone muted';
				else if (track.muted) status = 'Microphone unavailable — check your input device';
				else if (capture?.state !== 'running') status = 'Microphone paused — reconnect to resume';
				else if (now - lastCaptured > 2500) status = 'Microphone capture stalled — reconnect';
				else if (!capturedSamples) status = 'Waiting for microphone';
				else if (!sentSamples || now - lastSent > 2500) status = 'Microphone audio waiting to send';
				if (status !== micStatus) {
					log('microphone-status', {
						status,
						captureState: capture?.state,
						trackState: track.readyState,
						capturedSamples,
						sentSamples,
						queued
					});
					micStatus = status;
				}
				if (now - lastCaptured > 2500) micLevel = 0;
			}, 1000);
			const source = capture.createMediaStreamSource(media!);
			processor = capture.createScriptProcessor(4096, 1, 1);
			const mute = capture.createGain();
			mute.gain.value = 0;
			processor.onaudioprocess = (e) => {
				if (id !== sessionId) return;
				const samples = resampleToPcm(
					e.inputBuffer.getChannelData(0),
					capture!.sampleRate,
					inputRate
				);
				lastCaptured = performance.now();
				capturedSamples += samples.length;
				const rms =
					Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) /
					32768;
				micLevel = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.00001)) + 60) / 60));
				command({ type: 'audio', samples: Array.from(samples) })
					.then(() => {
						if (id !== sessionId) return;
						lastSent = performance.now();
						sentSamples += samples.length;
					})
					.catch((e) => {
						if (id === sessionId) fail(e);
					});
			};
			source.connect(processor);
			processor.connect(mute);
			mute.connect(capture.destination);
		}
		if (camera) {
			if (cameraSource === 'webcam') {
				if (!video) throw new Error('Camera preview is unavailable');
				video.srcObject = media!;
				await video.play();
				if (id !== sessionId) return;
			}
			cameraTimer = setInterval(() => void snapshot(), 1000);
			await snapshot();
		}
	}
	async function snapshot() {
		if (!id || capturing) return;
		const source = cameraSource === 'room' ? roomCanvas : video;
		if (!source || (cameraSource === 'webcam' && !video?.videoWidth)) return;
		if (cameraSource === 'room' && roomCanvas?.width !== 960) {
			fail('Room renderer is unavailable. Check browser graphics support.');
			return;
		}
		const sessionId = id;
		capturing = true;
		try {
			const canvas = document.createElement('canvas');
			canvas.width = 640;
			const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
			const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
			canvas.height = Math.round((640 * height) / width);
			canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
			const data = canvas.toDataURL('image/jpeg', 0.65).split(',')[1];
			const id = ++frameId,
				capturedAtMs = Math.floor(performance.now() - started);
			await command({
				type: 'image',
				data,
				mime: 'image/jpeg',
				...(!live ? { id, capturedAtMs } : {})
			});
		} catch (e) {
			if (id === sessionId) fail(e);
		} finally {
			capturing = false;
		}
	}
	async function mute() {
		muted = !muted;
		media?.getAudioTracks().forEach((t) => (t.enabled = !muted));
		if (muted && !live) await command({ type: 'end-audio' });
	}
	function clearPlayback() {
		player?.clear();
		if (live && provider === 'openai' && liveCursor) {
			command(liveCursor).catch(fail);
			liveCursor = undefined;
		}
	}
	async function stopReply() {
		acceptAudio = false;
		clearPlayback();
		if (!live) timeline.stop(elapsed(), false);
		if (!live || provider === 'openai') await command({ type: 'interrupt' });
		phase = 'Listening';
	}
	async function send() {
		if (!text.trim()) return;
		const value = text;
		text = '';
		clearPlayback();
		acceptAudio = false;
		if (!live) {
			timeline.stop(elapsed());
			timeline.begin('typed', elapsed(), undefined, value);
		}
		await command({ type: 'text', text: value }).catch(fail);
	}
	async function disconnect() {
		if (phase === 'Disconnecting') return;
		phase = 'Disconnecting';
		const old = id;
		muted = false;
		if (playbackTimer) clearInterval(playbackTimer);
		playbackTimer = undefined;
		playing = false;
		id = '';
		connection?.abort();
		connection = undefined;
		liveCursor = undefined;
		acceptAudio = false;
		if (cameraTimer) clearInterval(cameraTimer);
		cameraTimer = undefined;
		if (micTimer) clearInterval(micTimer);
		micTimer = undefined;
		micLevel = 0;
		if (processor) {
			processor.onaudioprocess = null;
			processor.disconnect();
			processor = undefined;
		}
		media?.getTracks().forEach((t) => {
			t.onended = null;
			t.stop();
		});
		media = undefined;
		await capture?.close();
		capture = undefined;
		await player?.close();
		if (!live) timeline.stop(elapsed(), true, error ? 'error' : 'session-ended');
		player = undefined;
		if (old)
			await fetch(`/api/cascade/${old}`, { method: 'DELETE', keepalive: true }).catch(() => {});
		phase = 'Disconnected';
	}
	function chooseProvider() {
		if (live) {
			model = liveDefaults[provider].model;
			voice = liveDefaults[provider].voice;
			cameraSource = 'off';
			return;
		}
		model =
			configured[provider]?.model || providerConfigs.find((p) => p.id === provider)!.defaultModel;
	}
	function chooseSpeech() {
		ttsModel = tts === 'elevenlabs' ? 'eleven_flash_v2_5' : 'gpt-4o-mini-tts';
		voice = tts === 'elevenlabs' ? 'CwhRBWXzGAHq8TQ4Fs17' : 'alloy';
	}
	onMount(() => {
		cameraSource = simulator ? 'room' : 'off';
		settingsOpen = false;
		fetch('/api/cascade')
			.then((r) => r.json())
			.then((v) => {
				instructions = live ? v.instructions.live : v.instructions.cascade;
				configured = v.language;
				ready = true;
				keys = v;
				if (live) {
					liveDefaults = v.live;
					provider = 'openai';
					offline = false;
					mic = true;
				}
				if (!live && v.voice) voice = v.voice;
				chooseProvider();
				if (!live && configured[provider]?.configured && keys.deepgram && keys.elevenlabs) {
					offline = false;
					mic = true;
				}
			})
			.catch(fail);
		return () => {
			void disconnect();
		};
	});
</script>

<svelte:head
	><title>{live ? 'Live voice' : simulator ? 'Visual simulator' : 'Cascade'} · AIWrapper</title
	></svelte:head
>
<main class="agent-lab">
	<div class="page-heading">
		<div>
			<h1>{live ? 'Live voice' : simulator ? 'Visual simulator' : 'Cascade'}</h1>
			<p>
				{simulator
					? 'Walk, talk, and inspect what your agent sees.'
					: live
						? 'Talk with a native audio model.'
						: 'Test your speech-to-speech agent.'}
			</p>
		</div>
		<span class="provider-summary"
			>{offline
				? 'Offline test'
				: providerConfigs.find((p) => p.id === provider)?.label}{!offline && !live
				? ` · ${tts === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'} voice`
				: ''}</span
		>
	</div>

	<section class="session-bar" aria-label="Session controls">
		<div class="session-actions">
			{#if phase === 'Connecting'}
				<button class="primary" onclick={() => void disconnect()}
					><Square size={16} /> Cancel connection</button
				>
			{:else if !connected}
				<button
					class="primary"
					disabled={!ready || phase !== 'Disconnected'}
					onclick={() => void connect()}
					><Play size={16} fill="currentColor" /> Start session</button
				>
			{:else}
				<button class="primary end" onclick={() => void disconnect()}
					><Square size={16} fill="currentColor" /> End session</button
				>
			{/if}
			<button
				class:mic-enabled={mic && !muted && !offline}
				aria-pressed={mic && !muted && !offline}
				aria-label={offline
					? 'Microphone unavailable in offline mode'
					: connected && mic
						? muted
							? 'Unmute microphone'
							: 'Mute microphone'
						: mic
							? 'Turn microphone off'
							: 'Turn microphone on'}
				disabled={offline || !ready || phase === 'Connecting' || (connected && !mic)}
				onclick={() => {
					if (connected) void mute().catch(fail);
					else mic = !mic;
				}}
			>
				{#if mic && !muted && !offline}<Mic size={17} />{:else}<MicOff size={17} />{/if}
				{offline
					? 'Mic unavailable'
					: !mic
						? 'Mic off'
						: muted && connected
							? 'Mic muted'
							: 'Mic on'}
			</button>
			{#if connected}<button onclick={() => void stopReply().catch(fail)}
					><Volume2 size={17} />{live && provider === 'google'
						? 'Stop playback'
						: 'Stop reply'}</button
				>{/if}
		</div>
		<div class="session-status">
			<span class:active={connected} class:attention={Boolean(error)} class="status-dot"></span>
			<span role="status"
				>{phase === 'Disconnected'
					? error
						? 'Needs attention'
						: ready
							? 'Ready to start'
							: 'Loading'
					: playing && connected
						? 'Speaking'
						: phase}</span
			>
		</div>
		<div class="input-status">
			{#if connected && mic && !offline}<meter
					min="0"
					max="1"
					value={muted ? 0 : micLevel}
					aria-label="Microphone input level"
				></meter>{/if}
			<span
				>{offline
					? 'Offline test uses typed messages. Microphone and AI providers are disabled.'
					: !mic
						? connected
							? 'Microphone is off. End the session to enable it, or type a message.'
							: 'Microphone is off. Turn it on to speak, or use typed messages.'
						: connected
							? muted
								? 'Microphone muted. The agent cannot hear you.'
								: micStatus
							: error
								? 'The session stopped. Resolve the error below, then start again.'
								: 'Microphone is on for this session. Your browser will ask for access when you start.'}</span
			>
			{#if offline}<button
					class="text-button"
					onclick={() => {
						settingsOpen = true;
						settingsPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
					}}>Change mode</button
				>{/if}
		</div>
	</section>
	{#if error}<div role="alert" class="error-banner">
			<AlertCircle size={18} /><span>{error}</span>
		</div>{/if}

	<div class="workspace" class:no-visual={!camera}>
		{#if cameraSource === 'room'}<RoomSimulator
				bind:canvas={roomCanvas}
				active={connected && frameId > 0}
			/>
		{:else if cameraSource === 'webcam'}
			<section class="camera-card" aria-label="Camera preview">
				<div class="card-heading">
					<h2>Agent view</h2>
					<span class="small-label">{connected ? 'Webcam · 1 frame / s' : 'Webcam preview'}</span>
				</div>
				<div class="camera-preview">
					<video
						bind:this={video}
						autoplay
						muted
						playsinline
						aria-label="Camera preview"
						class:visible={connected}
					></video>
					{#if !connected}<div class="empty-camera">
							<Video size={30} />
							<p>Your webcam appears here when the session starts.</p>
						</div>{/if}
				</div>
			</section>
		{/if}
		<section class="conversation" aria-label="Conversation">
			<div class="card-heading">
				<h2>Conversation</h2>
				<span class="small-label"
					>{connected
						? 'Live transcript'
						: transcripts.length
							? 'Session ended'
							: offline || !mic
								? 'Text input'
								: 'Voice + text'}</span
				>
			</div>
			<div
				class="conversation-feed"
				bind:this={conversationFeed}
				onscroll={() => {
					if (conversationFeed)
						followConversation =
							conversationFeed.scrollHeight -
								conversationFeed.scrollTop -
								conversationFeed.clientHeight <
							64;
				}}
			>
				{#each transcripts as t}
					<article class:user-message={t.input} class="message">
						<p class="speaker">{t.input ? 'You' : 'Agent'}</p>
						{#if t.cut}
							{#if t.cut.retainedText}<p class="message-text">{t.cut.retainedText}</p>{/if}
							<p class="interruption-marker">
								<Square size={11} fill="currentColor" />
								Interrupted · {(t.cut.playedMs / 1000).toFixed(1)}s played
							</p>
							<p class="cut-accuracy">
								{t.cut.accuracy === 'provider-timed'
									? 'Cutoff from speech timing'
									: t.cut.accuracy === 'estimated'
										? 'Approximate word boundary'
										: 'Last confirmed complete segment'}
								{!t.cut.playbackConfirmed ? ' · final playback report unavailable' : ''}
							</p>
							{#if t.cut.unplayedText}<details class="unplayed-text">
									<summary>Generated remainder · excluded from model history</summary>
									<p class="message-text">{t.cut.unplayedText}</p>
									{#if t.cut.accuracy !== 'provider-timed'}<p class="cut-accuracy">
											Some words near this approximate cutoff may have played.
										</p>{/if}
								</details>{/if}
						{:else}<p class="message-text">{t.text}</p>{/if}
						{#if !live && t.input && t.turnId && turns.some((turn) => turn.id === t.turnId)}<button
								class="inspect-request"
								onclick={() => timelineView?.inspect(t.turnId!)}>Inspect request</button
							>{/if}
					</article>
				{:else}
					<div class="conversation-empty">
						<div class="empty-icon"><MessageSquare size={24} /></div>
						<h3>
							{connected
								? offline
									? 'Send a test message'
									: mic
										? 'Say something to your agent'
										: 'Type a message to begin'
								: 'Start a conversation'}
						</h3>
						<p>
							{connected
								? offline
									? 'Offline mode echoes text and tests the pipeline.'
									: camera
										? 'Ask what it sees, then move and ask what changed.'
										: 'Your words and the agent’s replies appear here.'
								: offline || !mic
									? 'Start the session above, then type a message below.'
									: 'Start the session above, then speak naturally. You can also type below.'}
						</p>
						{#if simulator}<div class="suggested-prompt">
								{offline ? 'Try: tool: add {"a":2,"b":3}' : 'Try “What can you see in this room?”'}
							</div>{/if}
					</div>
				{/each}
			</div>
			<form
				class="message-form"
				onsubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<label for="agent-message" class="small-label">Or type a message</label>
				<div class="composer">
					<input
						id="agent-message"
						aria-label="Message"
						bind:value={text}
						disabled={!connected}
						placeholder={connected ? 'Ask your agent…' : 'Start a session to send a message'}
					/>
					<button
						class="send-button"
						aria-label="Send message"
						disabled={!connected || !text.trim()}><Send size={17} /></button
					>
				</div>
			</form>
		</section>
	</div>

	<div class="inspector-heading">
		<h2>Configure & inspect</h2>
		<p>Fine-tune the session or review what happened.</p>
	</div>
	<div class="secondary-panels">
		{#if !live}
			<TurnTimelineView bind:this={timelineView} {turns} {elapsed} requests={requestSnapshots} />
		{/if}
		<details bind:open={settingsOpen} bind:this={settingsPanel} class="panel">
			<summary
				><Settings2 size={19} /><span
					><strong>Session settings</strong><small>Instructions, providers, and visual input</small
					></span
				><ChevronDown size={17} class="chevron" /></summary
			>
			<div class="instruction-editor">
				<label for="system-instructions">System instructions</label>
				<textarea
					id="system-instructions"
					bind:value={instructions}
					disabled={!ready}
					rows="7"
					maxlength="16000"
					spellcheck="false"
					aria-describedby="instructions-help"
				></textarea>
				<p id="instructions-help">
					Edits stay on this page and apply to the next session. Reloading resets them to the
					defaults.
				</p>
			</div>
			<fieldset disabled={!ready || phase !== 'Disconnected'} class="settings-fields space-y-5">
				{#if live}
					<div class="grid gap-4 md:grid-cols-3">
						<label
							>Provider<select
								aria-label="Live provider"
								bind:value={provider}
								onchange={chooseProvider}
							>
								<option value="openai"
									>OpenAI Realtime{configured.openai?.configured
										? ' · configured'
										: ' · key missing'}</option
								>
								<option value="google"
									>Gemini Live{configured.google?.configured
										? ' · configured'
										: ' · key missing'}</option
								>
							</select></label
						>
						<label>Model<input aria-label="Live model ID" bind:value={model} /></label>
						<label>Voice<input aria-label="Voice ID" bind:value={voice} /></label>
					</div>
					{#if provider === 'google'}<p class="text-sm text-neutral-600">
							Speak to interrupt Gemini. Stop playback silences local audio; it does not cancel
							generation.
						</p>{/if}
				{:else}
					<label class="flex items-center gap-2"
						><input type="checkbox" bind:checked={offline} />Offline test — echo replies and a short
						tone, no API calls (typed input only; microphone disabled)</label
					>
					<div class="grid gap-4 md:grid-cols-3">
						<div class="space-y-2">
							<label for="stt"
								>Transcription · {keys.deepgram ? 'key configured' : 'key missing'}</label
							><select id="stt" bind:value={sttModel}
								><option value="flux-general-en">Deepgram Flux · English</option><option
									value="flux-general-multi">Deepgram Flux · Multilingual</option
								></select
							>
						</div>
						<div class="space-y-2">
							<label for="llm">Language model</label><select
								id="llm"
								bind:value={provider}
								onchange={chooseProvider}
								>{#each providerConfigs as p}<option value={p.id}
										>{p.label}{configured[p.id]?.configured ? ' · configured' : ''}</option
									>{/each}</select
							><input aria-label="Language model ID" bind:value={model} placeholder="Model ID" />
						</div>
						<div class="space-y-2">
							<label for="tts">Speech output</label><select
								id="tts"
								bind:value={tts}
								onchange={chooseSpeech}
								><option value="elevenlabs"
									>ElevenLabs{keys.elevenlabs ? ' · configured' : ''}</option
								><option value="openai">OpenAI{keys.openai ? ' · configured' : ''}</option></select
							><input aria-label="Speech model ID" bind:value={ttsModel} /><input
								aria-label="Voice ID"
								bind:value={voice}
							/>
							<p class="text-xs text-neutral-500">
								ElevenLabs default: Roger. You can paste another voice ID.
							</p>
						</div>
					</div>
				{/if}
				<div class="grid gap-4 md:grid-cols-2">
					<label
						>Visual input<select
							aria-label="Visual input"
							bind:value={cameraSource}
							disabled={live && provider !== 'google'}
						>
							<option value="off">Off</option><option value="webcam">Webcam</option><option
								value="room">3D room</option
							>
						</select></label
					>
					{#if !live}<label
							>Frame selection<select aria-label="Frame selection" bind:value={cameraContext}>
								<option value="recent">Recent history · up to 12 frames</option><option
									value="latest">Latest frame only</option
								>
							</select></label
						>{/if}
				</div>
				{#if camera}<p class="text-xs text-neutral-500">
						Capture once per second.{!live
							? ' Recent history keeps up to five minutes, prioritizes the last six seconds and spreads remaining frames across the earlier interval since your last turn.'
							: ' Frames stream directly to the live provider.'}
					</p>{/if}
			</fieldset>
			{#if connected}<p class="panel-note">
					End the session to change providers or visual input.
				</p>{/if}
		</details>
		{#if !live && (camera || frameRequests.length)}
			<details class="panel">
				<summary
					><Images size={19} /><span
						><strong
							>Frames sent to the model <span class="count">{frameRequests.length}</span></strong
						><small
							>{frameRequests.length
								? 'Review exact images and capture times'
								: 'Selected images appear after your first question'}</small
						></span
					><ChevronDown size={17} class="chevron" /></summary
				>
				<FrameReview
					requests={frameRequests}
					bind:selected={frameRequestIndex}
					dropped={droppedRequests}
				/>
			</details>
		{/if}
		<details class="panel">
			<summary
				><List size={19} /><span
					><strong>Session events <span class="count">{entries.length}</span></strong><small
						>Requests, provider errors, and playback activity</small
					></span
				><ChevronDown size={17} class="chevron" /></summary
			>
			<div class="event-panel">
				<p class="panel-note">
					Select an event to inspect it. Retained after the session ends; last 300 events.
				</p>
				{#if connected && mic && !offline && !live}<button
						class="finish-speaking"
						onclick={() => void command({ type: 'end-audio' }).catch(fail)}
						>Finish speaking manually</button
					>{/if}
				<div class="event-layout">
					<div class="event-list">
						{#each entries as entry, i}<button
								class="event"
								class:selected-event={selected === i}
								onclick={() => (selected = i)}><span>{entry.time}s</span>{entry.label}</button
							>
						{:else}<p class="panel-note">
								No events yet. Start a session to record activity.
							</p>{/each}
					</div>
					{#if selected !== null && entries[selected]}<pre>{entries[selected]
								.detail}</pre>{:else}<div class="event-empty">Event details appear here.</div>{/if}
				</div>
			</div>
		</details>
	</div>
</main>

<style>
	.inspect-request {
		margin-top: 10px;
		font-size: 12px;
		color: #176957;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.agent-lab {
		max-width: 1440px;
		margin: 0 auto;
		padding: 28px 32px 48px;
		color: #202a30;
	}
	.page-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 22px;
	}
	h1 {
		font-size: 26px;
		font-weight: 650;
		letter-spacing: -0.7px;
		line-height: 1.3;
	}
	.page-heading p {
		font-size: 14px;
		color: #637078;
		margin-top: 5px;
	}
	.provider-summary {
		font-size: 12px;
		color: #68757d;
		text-align: right;
	}
	.session-bar {
		position: sticky;
		top: 10px;
		z-index: 10;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px;
		background: #fff;
		border: 1px solid #dce3e5;
		border-radius: 12px;
		box-shadow: 0 3px 12px #233c4710;
		margin-bottom: 20px;
	}
	.session-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 1px solid #d9e0e2;
		border-radius: 8px;
		padding: 9px 13px;
		font-size: 13px;
		font-weight: 500;
		background: #fff;
		color: #34434b;
		cursor: pointer;
		transition: background 0.12s;
	}
	button:hover:not(:disabled) {
		background: #f0f4f4;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:focus-visible,
	summary:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid #12816c;
		outline-offset: 3px;
	}
	button.primary {
		background: #176957;
		border-color: #176957;
		color: white;
		min-width: 155px;
	}
	button.primary:hover:not(:disabled) {
		background: #105443;
	}
	button.end {
		background: #263c43;
		border-color: #263c43;
	}
	button.mic-enabled {
		color: #166654;
		background: #edf7f2;
		border-color: #c8e2d8;
	}
	.session-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 550;
	}
	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #9aa8af;
	}
	.status-dot.active {
		background: #24856a;
		box-shadow: 0 0 0 3px #24856a17;
	}
	.status-dot.attention {
		background: #c24e3c;
	}
	.input-status {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-basis: 100%;
		color: #627178;
		font-size: 12px;
	}
	meter {
		width: 64px;
		height: 12px;
		flex-shrink: 0;
		accent-color: #176957;
	}
	button.text-button {
		border: 0;
		background: transparent;
		color: #176957;
		padding: 0;
		text-decoration: underline;
		font-size: 12px;
		flex-shrink: 0;
	}
	.error-banner {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		border: 1px solid #efc8c0;
		background: #fff4f1;
		color: #9b3424;
		border-radius: 10px;
		padding: 14px;
		font-size: 14px;
		margin-bottom: 20px;
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr);
		gap: 20px;
		align-items: stretch;
	}
	.workspace.no-visual {
		grid-template-columns: 1fr;
	}
	.conversation,
	.camera-card {
		min-width: 0;
		border: 1px solid #dfe5e7;
		border-radius: 12px;
		overflow: hidden;
		background: white;
		display: flex;
		flex-direction: column;
	}
	.conversation {
		height: 540px;
	}
	.card-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 17px 20px;
		border-bottom: 1px solid #edf0f1;
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
	}
	.small-label {
		font-size: 11px;
		color: #74828b;
	}
	.conversation-feed {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
		min-height: 0;
		overscroll-behavior: contain;
	}
	.conversation-empty {
		min-height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		max-width: 280px;
		margin: auto;
		color: #708087;
		font-size: 13px;
		line-height: 1.6;
	}
	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: #f1f5f4;
		color: #6c8a80;
		margin-bottom: 16px;
	}
	.conversation-empty h3 {
		color: #34454d;
		font-size: 15px;
		font-weight: 550;
		margin-bottom: 7px;
	}
	.suggested-prompt {
		border-top: 1px solid #edf0f1;
		margin-top: 20px;
		padding-top: 16px;
		font-size: 12px;
	}
	.message {
		padding: 12px 14px;
		border-radius: 10px;
		background: #f2f5f4;
		margin-bottom: 12px;
	}
	.message.user-message {
		background: #f2f5f8;
	}
	.speaker {
		font-size: 11px;
		font-weight: 650;
		color: #6b7c83;
		margin-bottom: 5px;
	}
	.message-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 14px;
		line-height: 1.55;
	}
	.interruption-marker {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		font-size: 12px;
		color: #94621d;
		font-weight: 550;
		border-top: 1px dashed #d8c5a5;
		padding-top: 8px;
	}
	.cut-accuracy {
		font-size: 11px;
		color: #7c7467;
		margin-top: 4px;
	}
	.unplayed-text {
		margin-top: 10px;
	}
	.unplayed-text > summary {
		display: list-item;
		list-style: disclosure-closed;
		padding: 0;
		font-size: 11px;
		color: #76838a;
		border: 0;
	}
	.unplayed-text[open] > summary {
		list-style: disclosure-open;
	}
	.unplayed-text > .message-text {
		color: #78868c;
		margin-top: 8px;
	}
	.message-form {
		padding: 14px 16px 16px;
		border-top: 1px solid #edf0f1;
	}
	.composer {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 7px;
	}
	input:not([type='checkbox']),
	select {
		width: 100%;
		min-width: 0;
		border: 1px solid #d7dfe2;
		border-radius: 7px;
		padding: 9px 10px;
		font-size: 13px;
		background: white;
		color: #34454d;
	}
	.composer input {
		flex: 1;
	}
	.composer input:disabled {
		background: #f8fafa;
	}
	button.send-button {
		padding: 10px;
		background: #176957;
		border-color: #176957;
		color: white;
	}
	.camera-preview {
		position: relative;
		flex: 1;
		background: #f1f4f4;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 300px;
	}
	video {
		width: 100%;
		max-height: 470px;
		object-fit: contain;
		visibility: hidden;
	}
	video.visible {
		visibility: visible;
	}
	.empty-camera {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		font-size: 13px;
		color: #718087;
		max-width: 250px;
		text-align: center;
	}
	.inspector-heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin: 26px 0 12px;
	}
	.inspector-heading p {
		color: #7b878d;
		font-size: 12px;
	}
	.secondary-panels {
		display: grid;
		gap: 10px;
	}
	.panel {
		border: 1px solid #dfe5e7;
		border-radius: 10px;
		background: white;
		min-width: 0;
	}
	summary {
		display: flex;
		align-items: center;
		gap: 13px;
		padding: 15px 18px;
		cursor: pointer;
		color: #62757d;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary > span {
		flex: 1;
		min-width: 0;
	}
	summary strong {
		display: block;
		color: #36474f;
		font-size: 13px;
		font-weight: 550;
	}
	summary small {
		display: block;
		color: #7a888f;
		font-size: 12px;
		margin-top: 3px;
	}
	summary :global(.chevron) {
		transition: transform 0.15s;
	}
	details[open] > summary :global(.chevron) {
		transform: rotate(180deg);
	}
	details[open] > summary {
		border-bottom: 1px solid #edf0f1;
	}
	.count {
		font-size: 11px;
		font-weight: 450;
		color: #7b8a91;
		margin-left: 5px;
	}
	.instruction-editor {
		padding: 20px 20px 0;
	}
	.instruction-editor label {
		display: block;
		font-size: 13px;
		font-weight: 550;
		margin-bottom: 8px;
	}
	.instruction-editor textarea {
		display: block;
		width: 100%;
		min-height: 140px;
		resize: vertical;
		border: 1px solid #d7dfe2;
		border-radius: 7px;
		padding: 10px 12px;
		font: inherit;
		font-size: 13px;
		line-height: 1.6;
		color: #34454d;
		background: white;
	}
	.instruction-editor textarea:focus-visible {
		outline: 2px solid #12816c;
		outline-offset: 3px;
	}
	.instruction-editor p {
		color: #75838b;
		font-size: 12px;
		margin-top: 7px;
	}
	.settings-fields {
		padding: 20px;
		font-size: 13px;
	}
	.settings-fields label {
		color: #4c5c64;
		font-size: 12px;
	}
	.panel-note {
		font-size: 12px;
		color: #75838b;
		padding: 0 20px 16px;
	}
	.event-panel {
		padding-top: 16px;
	}
	.event-layout {
		display: grid;
		grid-template-columns: minmax(200px, 1fr) minmax(0, 2fr);
		gap: 16px;
		padding: 0 18px 18px;
	}
	.event-list {
		max-height: 320px;
		overflow: auto;
		border: 1px solid #e3e8ea;
		border-radius: 7px;
	}
	.event {
		display: flex;
		width: 100%;
		text-align: left;
		justify-content: flex-start;
		border: 0;
		border-radius: 0;
		padding: 10px;
		font-size: 12px;
		border-bottom: 1px solid #edf0f1;
	}
	.event span {
		font-family: monospace;
		color: #819099;
		min-width: 60px;
	}
	.event.selected-event {
		background: #edf6f2;
		color: #176957;
	}
	pre {
		max-height: 320px;
		overflow: auto;
		border-radius: 7px;
		background: #f5f7f8;
		padding: 14px;
		font-size: 11px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.event-empty {
		display: grid;
		place-items: center;
		color: #829098;
		font-size: 12px;
		background: #f8fafa;
		border-radius: 7px;
	}
	.finish-speaking {
		margin: 0 20px 16px;
	}
	@media (min-width: 1600px) {
		.conversation {
			height: 600px;
		}
	}
	@media (max-width: 900px) {
		.agent-lab {
			padding: 20px 18px 36px;
		}
		.workspace {
			grid-template-columns: 1fr;
		}
		.conversation {
			height: 420px;
		}
		.provider-summary {
			display: none;
		}
		.session-bar {
			top: 0;
		}
		.page-heading {
			margin-bottom: 18px;
		}
		.inspector-heading {
			display: block;
		}
		.inspector-heading p {
			margin-top: 4px;
		}
	}
	@media (max-width: 520px) {
		.agent-lab {
			padding: 18px 12px 30px;
		}
		.session-bar {
			padding: 12px;
		}
		.session-actions {
			gap: 6px;
		}
		button {
			padding: 8px 10px;
			font-size: 12px;
		}
		button.primary {
			min-width: 0;
		}
		.session-status {
			font-size: 12px;
		}
		.input-status {
			font-size: 11px;
		}
		.event-layout {
			grid-template-columns: 1fr;
		}
		h1 {
			font-size: 23px;
		}
	}
</style>
