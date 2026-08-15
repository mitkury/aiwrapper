<script lang="ts">
	import { onMount } from 'svelte';
	import { PcmStreamPlayer } from '$lib/realtime/pcm-player';
	import { resampleToPcm } from '$lib/realtime/pcm';
	import {
		RemoteSpeechToSpeechSession,
		type RemoteSpeechToSpeechEvent,
		type SpeechToSpeechProviderId
	} from '$lib/speech-to-speech/remote-speech-to-speech-session';

	type ProviderConfig = {
		configured: boolean;
		model: string;
		voice: string;
	};
	type LiveConfig = Record<SpeechToSpeechProviderId, ProviderConfig>;
	type Phase = 'disconnected' | 'connecting' | 'listening' | 'thinking' | 'speaking';
	type TranscriptEntry = {
		id: number;
		speaker: 'user' | 'assistant';
		text: string;
		final: boolean;
	};

	let config = $state<LiveConfig>({
		openai: { configured: false, model: 'gpt-realtime-2.1', voice: 'marin' },
		gemini: { configured: false, model: 'gemini-3.1-flash-live-preview', voice: 'Kore' }
	});
	let configLoaded = $state(false);
	let provider = $state<SpeechToSpeechProviderId>('openai');
	let model = $state('gpt-realtime-2.1');
	let voice = $state('marin');
	let instructions = $state(
		'You are a concise live voice assistant. Reply naturally and keep spoken answers brief.'
	);
	let phase = $state<Phase>('disconnected');
	let transcripts: TranscriptEntry[] = $state([]);
	let error = $state('');
	let sessionInputRate = $state<number | undefined>();

	let session: RemoteSpeechToSpeechSession | undefined;
	let unsubscribe: (() => void) | undefined;
	let mediaStream: MediaStream | undefined;
	let recordingContext: AudioContext | undefined;
	let recordingSource: MediaStreamAudioSourceNode | undefined;
	let recordingProcessor: ScriptProcessorNode | undefined;
	let recordingGain: GainNode | undefined;
	let player: PcmStreamPlayer | undefined;
	let audioUploadTail = Promise.resolve();
	let transcriptId = 0;

	const selectedConfig = $derived(config[provider]);
	const canConnect = $derived(
		configLoaded && selectedConfig.configured && model.trim() && voice.trim()
	);
	const connected = $derived(phase !== 'disconnected' && phase !== 'connecting');

	onMount(() => {
		void loadConfig();
		return () => {
			void disconnect();
		};
	});

	async function loadConfig() {
		try {
			const response = await fetch('/api/speech-to-speech/config');
			if (!response.ok) throw new Error('Could not load live voice configuration');
			config = (await response.json()) as LiveConfig;
			const initialProvider = config.openai.configured
				? 'openai'
				: config.gemini.configured
					? 'gemini'
					: 'openai';
			selectProvider(initialProvider);
		} catch (value) {
			error = errorMessage(value);
		} finally {
			configLoaded = true;
		}
	}

	function selectProvider(next: SpeechToSpeechProviderId) {
		provider = next;
		model = config[next].model;
		voice = config[next].voice;
	}

	async function connect() {
		if (!canConnect || phase !== 'disconnected') return;
		error = '';
		transcripts = [];
		phase = 'connecting';
		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				},
				video: false
			});
			player = new PcmStreamPlayer();
			await player.resume();
			session = new RemoteSpeechToSpeechSession({
				provider,
				model: model.trim(),
				voice: voice.trim(),
				instructions: instructions.trim()
			});
			unsubscribe = session.subscribe(handleEvent);
			await session.connect();
			sessionInputRate = session.inputSampleRate;
			startMicrophone(session);
			phase = 'listening';
		} catch (value) {
			error = errorMessage(value);
			await disconnect();
		}
	}

	function startMicrophone(activeSession: RemoteSpeechToSpeechSession) {
		if (!mediaStream) return;
		recordingContext = new AudioContext();
		recordingSource = recordingContext.createMediaStreamSource(mediaStream);
		recordingProcessor = recordingContext.createScriptProcessor(4096, 1, 1);
		recordingGain = recordingContext.createGain();
		recordingGain.gain.value = 0;
		recordingProcessor.onaudioprocess = (event) => {
			if (phase === 'disconnected') return;
			const samples = resampleToPcm(
				event.inputBuffer.getChannelData(0),
				recordingContext?.sampleRate ?? activeSession.inputSampleRate,
				activeSession.inputSampleRate
			);
			audioUploadTail = audioUploadTail
				.then(() =>
					activeSession.sendAudio({
						encoding: 'pcm_s16le',
						channels: 1,
						sampleRate: activeSession.inputSampleRate,
						samples
					})
				)
				.catch((value) => {
					if (phase !== 'disconnected') error = errorMessage(value);
				});
		};
		recordingSource.connect(recordingProcessor);
		recordingProcessor.connect(recordingGain);
		recordingGain.connect(recordingContext.destination);
	}

	function handleEvent(event: RemoteSpeechToSpeechEvent) {
		if (event.type === 'audio') {
			player?.enqueue(event.frame);
			return;
		}
		if (event.type === 'transcript') {
			updateTranscript(event);
			if (event.speaker === 'user') phase = 'thinking';
			return;
		}
		if (event.type === 'speech' && event.speaker === 'assistant') {
			phase = event.active ? 'speaking' : 'listening';
			return;
		}
		if (event.type === 'interrupted') {
			player?.clear();
			finalizeTranscripts();
			phase = 'listening';
			return;
		}
		if (event.type === 'turn_complete') {
			finalizeTranscripts();
			phase = 'listening';
			return;
		}
		if (event.type === 'error') {
			error = event.error.message;
			phase = 'listening';
		}
	}

	function updateTranscript(event: Extract<RemoteSpeechToSpeechEvent, { type: 'transcript' }>) {
		const last = transcripts[transcripts.length - 1];
		if (!event.final) {
			if (last && !last.final && last.speaker === event.speaker) {
				last.text += event.text;
				transcripts = [...transcripts];
			} else {
				transcripts = [
					...transcripts,
					{ id: ++transcriptId, speaker: event.speaker, text: event.text, final: false }
				];
			}
			return;
		}
		if (last && !last.final && last.speaker === event.speaker) {
			last.text = event.text;
			last.final = true;
			transcripts = [...transcripts];
		} else {
			transcripts = [
				...transcripts,
				{ id: ++transcriptId, speaker: event.speaker, text: event.text, final: true }
			];
		}
	}

	function finalizeTranscripts() {
		let changed = false;
		for (const transcript of transcripts) {
			if (!transcript.final) {
				transcript.final = true;
				changed = true;
			}
		}
		if (changed) transcripts = [...transcripts];
	}

	async function disconnect() {
		recordingProcessor?.disconnect();
		recordingSource?.disconnect();
		recordingGain?.disconnect();
		recordingProcessor = undefined;
		recordingSource = undefined;
		recordingGain = undefined;
		mediaStream?.getTracks().forEach((track) => track.stop());
		mediaStream = undefined;
		if (recordingContext && recordingContext.state !== 'closed') await recordingContext.close();
		recordingContext = undefined;
		await audioUploadTail;
		const activeSession = session;
		session = undefined;
		if (activeSession) await activeSession.close().catch(() => undefined);
		unsubscribe?.();
		unsubscribe = undefined;
		await player?.close();
		player = undefined;
		sessionInputRate = undefined;
		phase = 'disconnected';
	}

	function errorMessage(value: unknown): string {
		return value instanceof Error ? value.message : 'Something went wrong';
	}

	function phaseLabel(value: Phase): string {
		if (value === 'connecting') return 'Connecting';
		if (value === 'listening') return 'Listening';
		if (value === 'thinking') return 'Thinking';
		if (value === 'speaking') return 'Speaking';
		return 'Disconnected';
	}
</script>

<main class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
	<div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-xs font-semibold tracking-wider text-neutral-400 uppercase">Native audio</p>
			<h1 class="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">Live voice models</h1>
			<p class="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
				Talk directly to one persistent speech-to-speech model. Change the provider or model, then
				reconnect; microphone and playback code stays the same.
			</p>
		</div>
		<button
			onclick={connected ? disconnect : connect}
			disabled={phase === 'connecting' || (!connected && !canConnect)}
			class="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
		>
			{connected ? 'Disconnect' : phase === 'connecting' ? 'Connecting…' : 'Connect microphone'}
		</button>
	</div>

	<section class="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
		<div class="grid gap-4 sm:grid-cols-3">
			<div>
				<label for="live-provider" class="block text-xs font-medium text-neutral-600"
					>Provider</label
				>
				<select
					id="live-provider"
					value={provider}
					onchange={(event) =>
						selectProvider(
							(event.currentTarget as HTMLSelectElement).value as SpeechToSpeechProviderId
						)}
					disabled={phase !== 'disconnected'}
					class="mt-1.5 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
				>
					<option value="openai" disabled={configLoaded && !config.openai.configured}>
						OpenAI Realtime{config.openai.configured ? ' ✓' : ''}
					</option>
					<option value="gemini" disabled={configLoaded && !config.gemini.configured}>
						Gemini Live{config.gemini.configured ? ' ✓' : ''}
					</option>
				</select>
			</div>
			<div>
				<label for="live-model" class="block text-xs font-medium text-neutral-600">Model</label>
				<input
					id="live-model"
					list="live-model-options"
					bind:value={model}
					disabled={phase !== 'disconnected'}
					class="mt-1.5 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
				/>
				<datalist id="live-model-options">
					{#if provider === 'openai'}
						<option value="gpt-realtime-2.1"></option>
						<option value="gpt-realtime-2.1-mini"></option>
						<option value="gpt-realtime-2"></option>
						<option value="gpt-realtime-1.5"></option>
					{:else}
						<option value="gemini-3.1-flash-live-preview"></option>
					{/if}
				</datalist>
			</div>
			<div>
				<label for="live-voice" class="block text-xs font-medium text-neutral-600">Voice</label>
				<input
					id="live-voice"
					list="live-voice-options"
					bind:value={voice}
					disabled={phase !== 'disconnected'}
					class="mt-1.5 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
				/>
				<datalist id="live-voice-options">
					{#if provider === 'openai'}
						<option value="marin"></option>
						<option value="cedar"></option>
						<option value="coral"></option>
					{:else}
						<option value="Kore"></option>
						<option value="Puck"></option>
						<option value="Aoede"></option>
					{/if}
				</datalist>
			</div>
		</div>
		<label for="live-instructions" class="mt-4 block text-xs font-medium text-neutral-600"
			>Instructions</label
		>
		<textarea
			id="live-instructions"
			bind:value={instructions}
			disabled={phase !== 'disconnected'}
			rows="2"
			class="mt-1.5 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
		></textarea>
		<p class="mt-3 text-xs text-neutral-500">
			{#if !configLoaded}
				Loading server configuration…
			{:else if selectedConfig.configured}
				{provider === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY'} is configured on the server.
			{:else}
				Add {provider === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY'} to the repository .env file.
			{/if}
		</p>
	</section>

	{#if error}
		<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
			{error}
		</div>
	{/if}

	<section
		class="mt-4 flex min-h-[420px] flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
	>
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<span
				class={`rounded-full px-2.5 py-1 ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}
			>
				{phaseLabel(phase)}
			</span>
			<span class="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
				{provider === 'openai' ? 'OpenAI Realtime' : 'Gemini Live'} · {model}
			</span>
			{#if sessionInputRate}
				<span class="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
					{sessionInputRate / 1000} kHz input
				</span>
			{/if}
		</div>

		<div class="mt-5 flex-1 space-y-3 overflow-y-auto">
			{#if transcripts.length === 0}
				<div
					class="rounded-xl border border-dashed border-neutral-200 px-4 py-12 text-center text-sm text-neutral-500"
				>
					{connected
						? 'Speak naturally. The live model listens, responds, and handles interruption.'
						: 'Choose a live model and connect your microphone.'}
				</div>
			{/if}
			{#each transcripts as entry (entry.id)}
				<div class={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
					<div
						class={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${entry.speaker === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-900'} ${entry.final ? '' : 'opacity-70'}`}
					>
						{entry.text}{entry.final ? '' : ' …'}
					</div>
				</div>
			{/each}
		</div>
	</section>
</main>
