<script lang="ts">
	import { onMount } from 'svelte';
	import { providerConfigs, type ProviderId } from '$lib/provider-config';
	import { resampleToPcm } from '$lib/realtime/pcm';
	import { CascadePlayer, PlaybackQueueFull, type Cursor } from '$lib/realtime/cascade-player';
	let { live = false }: { live?: boolean } = $props();
	let liveDefaults: Record<string, { model: string; voice: string }> = {};
	let inputRate = 24000,
		responseIndex = 0;
	let liveCursor: Cursor | undefined;
	let ready = $state(false);
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
		mic = $state(false),
		camera = $state(false);
	let configured = $state<Record<string, { configured: boolean; model: string }>>({});
	let keys = $state({ deepgram: false, elevenlabs: false, openai: false });
	let entries = $state<{ time: string; label: string; detail: string }[]>([]);
	let transcripts = $state<{ id: string; input: boolean; text: string }[]>([]);
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
	function log(label: string, detail: unknown) {
		entries = [
			...entries.slice(-299),
			{
				time: ((performance.now() - started) / 1000).toFixed(2),
				label,
				detail: JSON.stringify(detail, null, 2)
			}
		];
		while (
			entries.length > 1 &&
			entries.reduce((size, e) => size + e.detail.length, 0) > 8 * 1024 * 1024
		)
			entries = entries.slice(1);
	}
	function fail(e: unknown) {
		error = e instanceof Error ? e.message : String(e);
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
		if (packet.type === 'error') {
			fail(packet.message);
			return;
		}
		if (packet.type !== 'model') {
			log(packet.type, packet);
			return;
		}
		const e = packet.event;
		if (e.type === 'audio') {
			if (acceptAudio) {
				const item = e.item_id || `live-${responseIndex}`;
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
			const value = { id: key, input: e.input, text: e.text };
			if (previous < 0) transcripts = [...transcripts.slice(-99), value];
			else transcripts[previous] = value;
			if (!e.final_result) return;
		}
		if (e.type === 'provider-state') {
			if (e.state.kind === 'connected') {
				phase = 'Listening';
				inputRate = e.state.inputSampleRate || 24000;
				startMedia().catch(fail);
			}
			if (e.state.kind === 'synthesis-complete') phase = 'Listening';
			log(e.state.kind || 'provider-state', e.state);
			return;
		}
		log(e.type, e);
	}
	async function connect() {
		error = '';
		micStatus = 'Waiting for microphone';
		micLevel = 0;
		entries = [];
		transcripts = [];
		selected = null;
		started = performance.now();
		phase = 'Connecting';
		connection = new AbortController();
		const current = connection;
		try {
			player = new CascadePlayer((cursor) => {
				if (!live) command(cursor).catch(fail);
				else if (liveCursor?.item === cursor.item && liveCursor.index === cursor.index)
					liveCursor = cursor;
			});
			await player.resume();
			const response = await fetch('/api/cascade', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					offline,
					live,
					microphone: mic,
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
		media = await navigator.mediaDevices.getUserMedia({
			audio:
				mic && !offline
					? { channelCount: 1, echoCancellation: true, noiseSuppression: true }
					: false,
			video: camera ? { width: { ideal: 640 }, height: { ideal: 360 } } : false
		});
		if (!id) {
			media.getTracks().forEach((t) => t.stop());
			return;
		}
		if (mic && !offline) {
			const track = media.getAudioTracks()[0];
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
			const sessionId = id;
			track.onended = () => {
				if (id === sessionId)
					fail('Microphone disconnected. Check the input device and reconnect.');
			};
			capture = new AudioContext();
			await capture.resume();
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
			const source = capture.createMediaStreamSource(media);
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
			if (!video) return;
			video.srcObject = media;
			await video.play();
			cameraTimer = setInterval(() => void snapshot(), 1000);
			await snapshot();
		}
	}
	async function snapshot() {
		if (!id || !video?.videoWidth) return;
		const canvas = document.createElement('canvas');
		canvas.width = 640;
		canvas.height = Math.round((640 * video.videoHeight) / video.videoWidth);
		canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
		const data = canvas.toDataURL('image/jpeg', 0.65).split(',')[1];
		await command({ type: 'image', data, mime: 'image/jpeg' }).catch(fail);
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
		if (!live || provider === 'openai') await command({ type: 'interrupt' });
		phase = 'Listening';
	}
	async function send() {
		if (!text.trim()) return;
		const value = text;
		text = '';
		clearPlayback();
		acceptAudio = false;
		await command({ type: 'text', text: value }).catch(fail);
	}
	async function disconnect() {
		const old = id;
		id = '';
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
		player = undefined;
		connection?.abort();
		if (old)
			await fetch(`/api/cascade/${old}`, { method: 'DELETE', keepalive: true }).catch(() => {});
		phase = 'Disconnected';
	}
	function chooseProvider() {
		if (live) {
			model = liveDefaults[provider].model;
			voice = liveDefaults[provider].voice;
			camera = false;
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
		fetch('/api/cascade')
			.then((r) => r.json())
			.then((v) => {
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

<svelte:head><title>{live ? 'Live voice' : 'Cascade'} · AIWrapper</title></svelte:head>
<main class="mx-auto max-w-6xl space-y-6 p-6">
	<div>
		<h1 class="text-2xl font-semibold">{live ? 'Live voice' : 'Cascade'}</h1>
		<p class="mt-1 text-sm text-neutral-600">
			{live
				? 'Native audio conversation with OpenAI Realtime or Gemini Live. Session and tools run in Rust.'
				: 'Continuous transcription → language model → streamed speech. Session and tools run in Rust.'}
		</p>
	</div>
	<fieldset
		disabled={!ready || phase !== 'Disconnected'}
		class="space-y-4 rounded-xl border border-neutral-200 p-4"
	>
		<legend class="px-2 font-medium">Providers</legend>
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
					<label for="stt">Transcription · {keys.deepgram ? 'key configured' : 'key missing'}</label
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
						><option value="elevenlabs">ElevenLabs{keys.elevenlabs ? ' · configured' : ''}</option
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
		<div class="flex gap-6">
			<label><input type="checkbox" bind:checked={mic} disabled={offline} /> Microphone</label
			><label
				><input type="checkbox" bind:checked={camera} disabled={live && provider !== 'google'} /> Camera
				· latest frame once per second</label
			>
		</div>
	</fieldset>
	<div class="flex items-center gap-3">
		{#if phase === 'Connecting'}<button onclick={() => void disconnect()}>Cancel connection</button
			>{:else if !connected}<button disabled={!ready} onclick={() => void connect()}>Connect</button
			>{:else}<button onclick={() => void stopReply().catch(fail)}
				>{live && provider === 'google' ? 'Stop playback' : 'Stop reply'}</button
			><button onclick={() => void disconnect()}>Disconnect</button>{#if mic && !offline}<button
					onclick={() => void mute().catch(fail)}>{muted ? 'Unmute mic' : 'Mute mic'}</button
				>{#if !live}<button onclick={() => void command({ type: 'end-audio' }).catch(fail)}
						>Finish speaking</button
					>{/if}{/if}{/if}
		<span role="status" class="text-sm text-neutral-600">{phase}</span>
	</div>
	{#if connected && mic && !offline}
		<div class="flex items-center gap-3 text-sm text-neutral-600">
			<meter min="0" max="1" value={micLevel} aria-label="Microphone input level"></meter>
			<span>{micStatus}</span>
		</div>
	{/if}
	{#if error}<p role="alert" class="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>{/if}
	{#if camera}<video
			bind:this={video}
			autoplay
			muted
			playsinline
			class="max-h-48 rounded-lg"
			aria-label="Camera preview"
		></video>{/if}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void send();
		}}
		class="flex gap-2"
	>
		<input
			aria-label="Message"
			bind:value={text}
			disabled={!connected}
			placeholder={offline
				? 'Try: tool: add {"a":2,"b":3}'
				: 'Type a message or speak into the microphone'}
			class="flex-1"
		/><button disabled={!connected || !text.trim()}>Send</button>
	</form>
	<div class="grid gap-6 md:grid-cols-2">
		<section>
			<h2 class="mb-3 font-medium">Conversation</h2>
			<div class="space-y-3">
				{#each transcripts as t}<div class="rounded-lg bg-neutral-50 p-3">
						<p class="text-xs font-medium text-neutral-500">
							{t.input ? 'You' : 'Assistant · generated text'}
						</p>
						<p class="whitespace-pre-wrap">{t.text}</p>
					</div>{:else}<p class="text-sm text-neutral-500">
						Connect, then speak or type. Offline mode uses typed input.
					</p>{/each}
			</div>
		</section>
		<section>
			<h2 class="mb-3 font-medium">Session events</h2>
			<p class="mb-2 text-xs text-neutral-500">
				Select an event to inspect it. Retained after disconnect; last 300 events.
			</p>
			<div class="max-h-64 overflow-auto rounded-lg border border-neutral-200">
				{#each entries as entry, i}<button class="event" onclick={() => (selected = i)}
						><span class="font-mono text-neutral-500">{entry.time}s</span> {entry.label}</button
					>{/each}
			</div>
			{#if selected !== null && entries[selected]}<pre
					class="mt-3 max-h-96 overflow-auto rounded-lg bg-neutral-50 p-3 text-xs whitespace-pre-wrap">{entries[
						selected
					].detail}</pre>{/if}
		</section>
	</div>
</main>

<style>
	input:not([type='checkbox']),
	select {
		width: 100%;
		border: 1px solid #d4d4d4;
		border-radius: 6px;
		padding: 8px;
		font-size: 14px;
		background: white;
	}
	button {
		border: 1px solid #d4d4d4;
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 14px;
		background: white;
	}
	button:hover:not(:disabled) {
		background: #f5f5f5;
	}
	button:disabled {
		opacity: 0.45;
	}
	.event {
		display: block;
		width: 100%;
		text-align: left;
		border: 0;
		border-radius: 0;
		font-size: 12px;
		border-bottom: 1px solid #eee;
	}
</style>
