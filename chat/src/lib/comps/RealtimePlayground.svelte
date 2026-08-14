<script lang="ts">
	import { onMount } from 'svelte';
	import { type AgentEvent, type LangMessages, type LangTool } from 'aiwrapper';
	import {
		RealtimeAgent,
		type RealtimeAgentEvent
	} from 'aiwrapper/unstable/realtime';
	import SecretsSetup from './SecretsSetup.svelte';
	import { getSecrets } from '$lib/secretsContext.svelte';
	import {
		createLanguageProvider,
		getProviderConfig,
		getProviderModel,
		getSelectedProviderId,
		isProviderConfigured
	} from '$lib/provider-config';
	import { RemoteSpeechToText, RemoteTextToSpeech } from '$lib/realtime/remote-speech';
	import { PcmStreamPlayer } from '$lib/realtime/pcm-player';

	type SpeechConfig = {
		openai: boolean;
		elevenlabs: boolean;
		elevenLabsVoiceId: string;
	};
	type Phase = 'disconnected' | 'connecting' | 'listening' | 'user-speaking' | 'thinking' | 'speaking';
	type TranscriptEntry = {
		id: number;
		speaker: 'user' | 'assistant';
		text: string;
		final: boolean;
	};

	const tools: LangTool[] = [
		{
			name: 'get_current_time',
			description: 'Get the current local time when the user asks for it.',
			parameters: { type: 'object', properties: {}, additionalProperties: false },
			handler: () => ({ localTime: new Date().toString() })
		}
	];

	const secrets = getSecrets();
	let speechConfig = $state<SpeechConfig>({
		openai: false,
		elevenlabs: false,
		elevenLabsVoiceId: ''
	});
	let phase = $state<Phase>('disconnected');
	let error = $state('');
	let providerReady = $state(false);
	let providerName = $state('OpenAI');
	let modelName = $state('');
	let ttsProvider = $state<'openai' | 'elevenlabs'>('openai');
	let voice = $state('coral');
	let cameraEnabled = $state(false);
	let microphoneEnabled = $state(true);
	let textInput = $state('');
	let transcripts: TranscriptEntry[] = $state([]);
	let llmFirstTokenMs = $state<number | undefined>();
	let ttsFirstAudioMs = $state<number | undefined>();
	let turnCompleteMs = $state<number | undefined>();
	let videoElement: HTMLVideoElement;
	let canvasElement: HTMLCanvasElement;

	let agent: RealtimeAgent | undefined;
	let unsubscribeAgent: (() => void) | undefined;
	let mediaStream: MediaStream | undefined;
	let recordingContext: AudioContext | undefined;
	let recordingSource: MediaStreamAudioSourceNode | undefined;
	let recordingProcessor: ScriptProcessorNode | undefined;
	let recordingGain: GainNode | undefined;
	let cameraTimer: ReturnType<typeof setInterval> | undefined;
	let audioUploadTail = Promise.resolve();
	let player: PcmStreamPlayer | undefined;
	let transcriptId = 0;

	const connected = $derived(phase !== 'disconnected' && phase !== 'connecting');
	const canConnect = $derived(
		providerReady &&
			speechConfig.openai &&
			(ttsProvider === 'openai' ? speechConfig.openai : speechConfig.elevenlabs)
	);

	$effect(() => {
		const providerId = getSelectedProviderId(secrets.values);
		const provider = getProviderConfig(providerId);
		providerName = provider.label;
		modelName = getProviderModel(provider, secrets.values);
		providerReady = isProviderConfigured(provider, secrets.values);
	});

	onMount(() => {
		void loadSpeechConfig();
		return () => {
			void disconnect();
		};
	});

	async function loadSpeechConfig() {
		try {
			const response = await fetch('/api/speech/config');
			if (!response.ok) throw new Error('Could not load speech configuration');
			speechConfig = (await response.json()) as SpeechConfig;
			if (speechConfig.elevenlabs) {
				ttsProvider = 'elevenlabs';
				voice = speechConfig.elevenLabsVoiceId;
			}
		} catch (loadError) {
			error = errorMessage(loadError);
		}
	}

	async function connect() {
		if (!canConnect || phase !== 'disconnected') return;
		error = '';
		phase = 'connecting';
		transcripts = [];
		resetLatency();

		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				},
				video: cameraEnabled
					? { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'environment' }
					: false
			});

			if (cameraEnabled && videoElement) {
				videoElement.srcObject = mediaStream;
				await videoElement.play();
			}

			player = new PcmStreamPlayer();
			await player.resume();
			const providerId = getSelectedProviderId(secrets.values);
			agent = new RealtimeAgent(
				createLanguageProvider(providerId, secrets.values, { optimizeForLatency: true }),
				{
					speechToText: new RemoteSpeechToText(),
					textToSpeech: new RemoteTextToSpeech(ttsProvider, voice),
					instructions:
						'You are a concise realtime voice assistant. Reply in the language of the latest user utterance. Use the latest camera image when it helps answer the user. Prefer short spoken responses.',
					tools,
					textSegmenter: { maxBufferedCharacters: 48, minimumSegmentCharacters: 12 }
				}
			);
			unsubscribeAgent = agent.subscribe(handleAgentEvent);
			await agent.connect();
			startMicrophone();
			if (cameraEnabled) {
				await captureCameraFrame();
				cameraTimer = setInterval(() => void captureCameraFrame(), 1000);
			}
			phase = 'listening';
		} catch (connectError) {
			error = errorMessage(connectError);
			await disconnect();
		}
	}

	function startMicrophone() {
		if (!mediaStream || !agent) return;
		recordingContext = new AudioContext();
		recordingSource = recordingContext.createMediaStreamSource(mediaStream);
		recordingProcessor = recordingContext.createScriptProcessor(4096, 1, 1);
		recordingGain = recordingContext.createGain();
		recordingGain.gain.value = 0;
		recordingProcessor.onaudioprocess = (event) => {
			if (!microphoneEnabled || !agent || phase === 'disconnected') return;
			const samples = resampleToPcm(
				event.inputBuffer.getChannelData(0),
				recordingContext?.sampleRate ?? 24000,
				24000
			);
			const activeAgent = agent;
			audioUploadTail = audioUploadTail
				.then(() =>
					activeAgent.sendAudio({
						encoding: 'pcm_s16le',
						channels: 1,
						sampleRate: 24000,
						samples
					})
				)
				.catch((uploadError) => {
					if (phase !== 'disconnected') error = errorMessage(uploadError);
				});
		};
		recordingSource.connect(recordingProcessor);
		recordingProcessor.connect(recordingGain);
		recordingGain.connect(recordingContext.destination);
	}

	async function captureCameraFrame() {
		if (!agent || !cameraEnabled || !videoElement || !canvasElement || !videoElement.videoWidth) return;
		const width = Math.min(384, videoElement.videoWidth);
		const height = Math.round((videoElement.videoHeight / videoElement.videoWidth) * width);
		canvasElement.width = width;
		canvasElement.height = height;
		const context = canvasElement.getContext('2d');
		if (!context) return;
		context.drawImage(videoElement, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) => canvasElement.toBlob(resolve, 'image/jpeg', 0.65));
		if (blob) agent.setImage({ kind: 'blob', blob, mimeType: 'image/jpeg' });
	}

	function handleAgentEvent(event: AgentEvent<LangMessages, RealtimeAgentEvent>) {
		if (event.type === 'speech') {
			const speech = event as Extract<RealtimeAgentEvent, { type: 'speech' }>;
			if (speech.speaker === 'user') {
				phase = speech.active ? 'user-speaking' : 'thinking';
			} else {
				phase = speech.active ? 'speaking' : 'listening';
			}
			return;
		}
		if (event.type === 'transcript') {
			updateTranscript(event as Extract<RealtimeAgentEvent, { type: 'transcript' }>);
			return;
		}
		if (event.type === 'audio') {
			player?.enqueue((event as Extract<RealtimeAgentEvent, { type: 'audio' }>).frame);
			return;
		}
		if (event.type === 'interrupted') {
			player?.clear();
			return;
		}
		if (event.type === 'latency') {
			const latency = event as Extract<RealtimeAgentEvent, { type: 'latency' }>;
			if (latency.stage === 'llm_first_token') llmFirstTokenMs = latency.milliseconds;
			if (latency.stage === 'tts_first_audio') ttsFirstAudioMs = latency.milliseconds;
			if (latency.stage === 'turn_complete') turnCompleteMs = latency.milliseconds;
			return;
		}
		if (event.type === 'turn_complete') phase = 'listening';
		if (event.type === 'error') {
			const reported = Reflect.get(event, 'error');
			error = errorMessage(reported);
		}
	}

	function updateTranscript(event: Extract<RealtimeAgentEvent, { type: 'transcript' }>) {
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
		if (event.speaker === 'user') {
			phase = 'thinking';
			resetLatency();
		}
	}

	async function sendTypedMessage(event: SubmitEvent) {
		event.preventDefault();
		const text = textInput.trim();
		if (!text || !agent) return;
		textInput = '';
		resetLatency();
		phase = 'thinking';
		try {
			await agent.sendText(text);
		} catch (sendError) {
			error = errorMessage(sendError);
		}
	}

	function selectTtsProvider(provider: 'openai' | 'elevenlabs') {
		ttsProvider = provider;
		voice = provider === 'elevenlabs' ? speechConfig.elevenLabsVoiceId : 'coral';
	}

	async function disconnect() {
		if (cameraTimer) clearInterval(cameraTimer);
		cameraTimer = undefined;
		recordingProcessor?.disconnect();
		recordingSource?.disconnect();
		recordingGain?.disconnect();
		recordingProcessor = undefined;
		recordingSource = undefined;
		recordingGain = undefined;
		mediaStream?.getTracks().forEach((track) => track.stop());
		mediaStream = undefined;
		if (videoElement) videoElement.srcObject = null;
		if (recordingContext && recordingContext.state !== 'closed') await recordingContext.close();
		recordingContext = undefined;
		await audioUploadTail;
		const activeAgent = agent;
		agent = undefined;
		if (activeAgent) await activeAgent.close().catch(() => undefined);
		unsubscribeAgent?.();
		unsubscribeAgent = undefined;
		await player?.close();
		player = undefined;
		phase = 'disconnected';
	}

	function resetLatency() {
		llmFirstTokenMs = undefined;
		ttsFirstAudioMs = undefined;
		turnCompleteMs = undefined;
	}

	function resampleToPcm(input: Float32Array, sourceRate: number, targetRate: number): Int16Array {
		const length = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
		const output = new Int16Array(length);
		for (let index = 0; index < length; index++) {
			const sourcePosition = (index * sourceRate) / targetRate;
			const left = Math.min(input.length - 1, Math.floor(sourcePosition));
			const right = Math.min(input.length - 1, left + 1);
			const fraction = sourcePosition - left;
			const sample = Math.max(-1, Math.min(1, input[left] * (1 - fraction) + input[right] * fraction));
			output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
		}
		return output;
	}

	function errorMessage(value: unknown): string {
		return value instanceof Error ? value.message : 'Something went wrong';
	}

	function phaseLabel(value: Phase): string {
		return value.replace('-', ' ');
	}
</script>

<div class="min-h-screen bg-neutral-50 text-neutral-900">
	<main class="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Realtime agent</h1>
				<p class="mt-1 text-sm text-neutral-500">Streaming STT → {providerName} → streaming TTS</p>
			</div>
			<SecretsSetup disabled={connected || phase === 'connecting'} />
		</div>

		<section class="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
			<div class="grid gap-0 md:grid-cols-[minmax(0,1fr)_280px]">
				<div class="flex min-h-[420px] flex-col p-5">
					<div class="flex flex-wrap items-center gap-2 text-xs">
						<span class={`rounded-full px-2.5 py-1 ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}>
							{phaseLabel(phase)}
						</span>
						<span class="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">LLM: {providerName} / {modelName}</span>
						<span class="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">TTS: {ttsProvider}</span>
					</div>

					<div class="mt-5 flex-1 space-y-3 overflow-y-auto">
						{#if transcripts.length === 0}
							<div class="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
								Connect, then speak naturally. Ask about what the camera sees or use the text box.
							</div>
						{/if}
						{#each transcripts as entry (entry.id)}
							<div class={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
								<div class={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${entry.speaker === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-900'} ${entry.final ? '' : 'opacity-70'}`}>
									{entry.text}{entry.final ? '' : ' …'}
								</div>
							</div>
						{/each}
					</div>

					<form class="mt-5 flex gap-2" onsubmit={sendTypedMessage}>
						<input
							bind:value={textInput}
							disabled={!connected}
							placeholder="Type while connected…"
							class="min-w-0 flex-1 rounded-full border-neutral-300 px-4 py-2 text-sm focus:border-neutral-500 focus:ring-neutral-500 disabled:bg-neutral-50"
						/>
						<button type="submit" disabled={!connected || !textInput.trim()} class="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Send</button>
					</form>
				</div>

				<aside class="border-t border-neutral-200 bg-neutral-50 p-5 md:border-t-0 md:border-l">
					<div class="relative aspect-video overflow-hidden rounded-xl bg-neutral-900">
						<video bind:this={videoElement} muted playsinline class={`h-full w-full object-cover ${cameraEnabled && connected ? '' : 'hidden'}`}></video>
						{#if !cameraEnabled || !connected}
							<div class="absolute inset-0 grid place-items-center text-xs text-neutral-400">Camera preview</div>
						{/if}
					</div>
					<canvas bind:this={canvasElement} class="hidden"></canvas>

					<div class="mt-5 space-y-3">
						<label class="flex items-center justify-between gap-3 text-sm text-neutral-700">
							<span>Camera context <span class="text-neutral-400">(slower)</span></span>
							<input type="checkbox" bind:checked={cameraEnabled} disabled={phase !== 'disconnected'} class="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500" />
						</label>
						<label class="flex items-center justify-between gap-3 text-sm text-neutral-700">
							<span>Microphone</span>
							<input type="checkbox" bind:checked={microphoneEnabled} disabled={!connected} class="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500" />
						</label>
					</div>

					<div class="mt-5">
						<label for="realtime-tts" class="text-xs font-medium text-neutral-600">Voice provider</label>
						<select id="realtime-tts" value={ttsProvider} onchange={(event) => selectTtsProvider((event.currentTarget as HTMLSelectElement).value as 'openai' | 'elevenlabs')} disabled={phase !== 'disconnected'} class="mt-1.5 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500">
							<option value="openai" disabled={!speechConfig.openai}>OpenAI</option>
							<option value="elevenlabs" disabled={!speechConfig.elevenlabs}>ElevenLabs</option>
						</select>
					</div>

					<div class="mt-5 grid grid-cols-3 gap-2 text-center text-[11px]">
						<div class="rounded-lg bg-white px-2 py-2"><div class="font-mono text-sm">{llmFirstTokenMs === undefined ? '—' : `${Math.round(llmFirstTokenMs)}ms`}</div><div class="mt-1 text-neutral-500">LLM token</div></div>
						<div class="rounded-lg bg-white px-2 py-2"><div class="font-mono text-sm">{ttsFirstAudioMs === undefined ? '—' : `${Math.round(ttsFirstAudioMs)}ms`}</div><div class="mt-1 text-neutral-500">first audio</div></div>
						<div class="rounded-lg bg-white px-2 py-2"><div class="font-mono text-sm">{turnCompleteMs === undefined ? '—' : `${Math.round(turnCompleteMs)}ms`}</div><div class="mt-1 text-neutral-500">complete</div></div>
					</div>

					<div class="mt-5">
						{#if connected || phase === 'connecting'}
							<button type="button" onclick={disconnect} class="w-full rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-100">Disconnect</button>
						{:else}
							<button type="button" onclick={connect} disabled={!canConnect} class="w-full rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40">Connect</button>
						{/if}
					</div>
				</aside>
			</div>
		</section>

		{#if error}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
		{/if}
		{#if !canConnect}
			<p class="mt-4 text-xs leading-relaxed text-neutral-500">
				Configure the selected LLM under Providers & Keys and add <code>OPENAI_API_KEY</code> for streaming STT plus an OpenAI or ElevenLabs TTS key to <code>chat/.env</code>.
			</p>
		{/if}
		<p class="mt-3 text-xs leading-relaxed text-neutral-500">
			This experiment keeps STT and TTS credentials on the server. Its SSE/audio-upload transport is only a playground adapter; production apps can feed the same agent pipeline from WebRTC directly. Headphones give the cleanest interruption behavior.
		</p>
	</main>
</div>
