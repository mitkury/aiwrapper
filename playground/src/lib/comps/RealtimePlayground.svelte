<script lang="ts">
	import { onMount } from 'svelte';
	import { getSecrets } from '$lib/secretsContext.svelte';
	import {
		getProviderConfig,
		getProviderModel,
		getProviderModels,
		getSelectedProviderId,
		providerConfigs,
		type ProviderId
	} from '$lib/provider-config';
	import { PcmStreamPlayer } from '$lib/realtime/pcm-player';
	import {
		RemoteRealtimeSession,
		type RemoteRealtimeEvent
	} from '$lib/realtime/remote-realtime-session';

	type SpeechConfig = {
		llm: Record<ProviderId, { configured: boolean; environmentKey?: string }>;
		stt: {
			openai: { configured: boolean; model: string };
			deepgram: { configured: boolean; model: string };
			elevenlabs: { configured: boolean; model: string };
		};
		tts: {
			openai: { configured: boolean; model: string; voice: string };
			elevenlabs: { configured: boolean; model: string; voice: string };
		};
	};
	type SttProvider = 'openai' | 'deepgram' | 'elevenlabs';
	type TtsProvider = 'openai' | 'elevenlabs';
	type VoiceOption = { id: string; name: string };
	type Phase =
		'disconnected' | 'connecting' | 'listening' | 'user-speaking' | 'thinking' | 'speaking';
	type TranscriptEntry = {
		id: number;
		speaker: 'user' | 'assistant';
		text: string;
		final: boolean;
	};
	type TimelinePart = {
		label: string;
		description: string;
		milliseconds: number;
		tone: 'stt' | 'input' | 'llm' | 'tts' | 'finish';
	};

	const secrets = getSecrets();
	let speechConfig = $state<SpeechConfig>({
		llm: Object.fromEntries(
			providerConfigs.map((provider) => [provider.id, { configured: false }])
		) as SpeechConfig['llm'],
		stt: {
			openai: { configured: false, model: 'gpt-4o-mini-transcribe' },
			deepgram: { configured: false, model: 'flux-general-en' },
			elevenlabs: { configured: false, model: 'scribe_v2_realtime' }
		},
		tts: {
			openai: { configured: false, model: 'gpt-4o-mini-tts', voice: 'coral' },
			elevenlabs: { configured: false, model: 'eleven_flash_v2_5', voice: '' }
		}
	});
	let speechConfigLoaded = $state(false);
	let phase = $state<Phase>('disconnected');
	let error = $state('');
	let errorSource = $state('');
	let llmProviderId = $state<ProviderId>('openai');
	let providerName = $state('OpenAI');
	let modelName = $state('');
	let sttProvider = $state<SttProvider>('openai');
	let sttModel = $state('gpt-4o-mini-transcribe');
	let ttsProvider = $state<TtsProvider>('openai');
	let ttsModel = $state('gpt-4o-mini-tts');
	let voice = $state('coral');
	let elevenLabsVoices: VoiceOption[] = $state([]);
	let loadingVoices = $state(false);
	let voiceLoadError = $state('');
	let cameraEnabled = $state(false);
	let microphoneEnabled = $state(true);
	let textInput = $state('');
	let transcripts: TranscriptEntry[] = $state([]);
	let sttFinalMs = $state<number | undefined>();
	let inputReadyMs = $state<number | undefined>();
	let llmFirstTokenMs = $state<number | undefined>();
	let ttsInputMs = $state<number | undefined>();
	let ttsFirstAudioMs = $state<number | undefined>();
	let turnCompleteMs = $state<number | undefined>();
	let videoElement: HTMLVideoElement;
	let canvasElement: HTMLCanvasElement;

	let agent: RemoteRealtimeSession | undefined;
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
	const llmProviderConfig = $derived(getProviderConfig(llmProviderId));
	const llmModels = $derived(getProviderModels(llmProviderConfig));
	const selectedLlmModelIsInCatalog = $derived(llmModels.some((model) => model.id === modelName));
	const llmServerConfig = $derived(speechConfig.llm[llmProviderId]);
	const providerReady = $derived(Boolean(llmServerConfig?.configured));
	const sttProviderConfig = $derived(speechConfig.stt[sttProvider]);
	const sttReady = $derived(sttProviderConfig.configured);
	const ttsReady = $derived(
		ttsProvider === 'openai'
			? speechConfig.tts.openai.configured
			: speechConfig.tts.elevenlabs.configured && Boolean(voice.trim())
	);
	const canConnect = $derived(speechConfigLoaded && providerReady && sttReady && ttsReady);
	const configurationHint = $derived.by(() => {
		if (!speechConfigLoaded) return 'Loading server speech configuration…';
		if (!sttReady)
			return `Add ${sttEnvironmentKey(sttProvider)} to .env for streaming transcription.`;
		if (!providerReady) return llmConfigurationHint(llmProviderId, providerName);
		if (ttsProvider === 'openai' && !speechConfig.tts.openai.configured) {
			return 'Add OPENAI_API_KEY to .env for OpenAI speech.';
		}
		if (ttsProvider === 'elevenlabs' && !speechConfig.tts.elevenlabs.configured) {
			return 'Add ELEVENLABS_API_KEY to .env for ElevenLabs speech.';
		}
		if (ttsProvider === 'elevenlabs' && !voice.trim()) {
			return 'Choose an ElevenLabs voice or enter its voice ID.';
		}
		return '';
	});
	const timelineParts = $derived.by(() => {
		const parts: TimelinePart[] = [];
		if (sttFinalMs !== undefined) {
			parts.push({
				label: 'STT final',
				description: 'Provider speech-end to final transcript',
				milliseconds: sttFinalMs,
				tone: 'stt'
			});
		}
		if (inputReadyMs !== undefined) {
			parts.push({
				label: 'Input prep',
				description: 'Transcript to model-ready text and image',
				milliseconds: inputReadyMs,
				tone: 'input'
			});
		}
		if (llmFirstTokenMs !== undefined) {
			parts.push({
				label: 'LLM wait',
				description: 'Model-ready input to first text token',
				milliseconds: Math.max(0, llmFirstTokenMs - (inputReadyMs ?? 0)),
				tone: 'llm'
			});
		}
		if (ttsInputMs !== undefined) {
			parts.push({
				label: 'Text buffer',
				description: 'First model token to first speakable segment',
				milliseconds: Math.max(0, ttsInputMs - (llmFirstTokenMs ?? 0)),
				tone: 'tts'
			});
		}
		if (ttsFirstAudioMs !== undefined) {
			parts.push({
				label: 'TTS wait',
				description: 'First segment submitted to first audio frame',
				milliseconds: Math.max(0, ttsFirstAudioMs - (ttsInputMs ?? llmFirstTokenMs ?? 0)),
				tone: 'tts'
			});
		}
		if (turnCompleteMs !== undefined) {
			parts.push({
				label: 'Finish',
				description: 'First audio to LLM and TTS completion',
				milliseconds: Math.max(0, turnCompleteMs - (ttsFirstAudioMs ?? 0)),
				tone: 'finish'
			});
		}
		return parts;
	});
	const timelineTotalMs = $derived(
		(sttFinalMs ?? 0) + (turnCompleteMs ?? ttsFirstAudioMs ?? llmFirstTokenMs ?? inputReadyMs ?? 0)
	);

	$effect(() => {
		const providerId = getSelectedProviderId(secrets.values);
		const provider = getProviderConfig(providerId);
		llmProviderId = providerId;
		providerName = provider.label;
		modelName = getProviderModel(provider, secrets.values);
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
			const selectedProvider = getSelectedProviderId(secrets.values);
			if (!speechConfig.llm[selectedProvider]?.configured) {
				const availableProvider = providerConfigs.find(
					(provider) => speechConfig.llm[provider.id]?.configured
				);
				if (availableProvider) selectLlmProvider(availableProvider.id);
			}
			const savedSttProvider = secrets.values.REALTIME_STT_PROVIDER;
			const preferredSttProvider: SttProvider = isSttProvider(savedSttProvider)
				? savedSttProvider
				: speechConfig.stt.openai.configured
					? 'openai'
					: speechConfig.stt.deepgram.configured
						? 'deepgram'
						: 'elevenlabs';
			applySttProvider(preferredSttProvider, false);

			const savedTtsProvider = secrets.values.REALTIME_TTS_PROVIDER;
			const preferredTtsProvider: TtsProvider =
				savedTtsProvider === 'elevenlabs' || savedTtsProvider === 'openai'
					? savedTtsProvider
					: speechConfig.tts.elevenlabs.configured &&
						  (!speechConfig.tts.openai.configured || Boolean(speechConfig.tts.elevenlabs.voice))
						? 'elevenlabs'
						: 'openai';
			applyTtsProvider(preferredTtsProvider, false);
			if (ttsProvider === 'elevenlabs') void loadElevenLabsVoices();
		} catch (loadError) {
			reportError('Configuration', loadError);
		} finally {
			speechConfigLoaded = true;
		}
	}

	async function connect() {
		if (!canConnect || phase !== 'disconnected') return;
		clearError();
		phase = 'connecting';
		transcripts = [];
		resetLatency();

		try {
			mediaStream =
				microphoneEnabled || cameraEnabled
					? await navigator.mediaDevices.getUserMedia({
							audio: microphoneEnabled
								? {
										channelCount: 1,
										echoCancellation: true,
										noiseSuppression: true,
										autoGainControl: true
									}
								: false,
							video: cameraEnabled
								? { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'environment' }
								: false
						})
					: undefined;

			if (cameraEnabled && mediaStream && videoElement) {
				videoElement.srcObject = mediaStream;
				await videoElement.play();
			}

			player = new PcmStreamPlayer();
			await player.resume();
			agent = new RemoteRealtimeSession({
				stt: { provider: sttProvider, model: sttModel },
				llm: { provider: llmProviderId, model: modelName },
				tts: { provider: ttsProvider, model: ttsModel, voice }
			});
			unsubscribeAgent = agent.subscribe(handleAgentEvent);
			await agent.connect();
			startMicrophone();
			if (cameraEnabled) {
				await captureCameraFrame();
				cameraTimer = setInterval(() => void captureCameraFrame(), 1000);
			}
			phase = 'listening';
		} catch (connectError) {
			reportError('Connection', connectError);
			await disconnect();
		}
	}

	function startMicrophone() {
		if (!microphoneEnabled || !mediaStream || !agent) return;
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
					if (phase !== 'disconnected') reportError('Speech input', uploadError);
				});
		};
		recordingSource.connect(recordingProcessor);
		recordingProcessor.connect(recordingGain);
		recordingGain.connect(recordingContext.destination);
	}

	async function captureCameraFrame() {
		if (!agent || !cameraEnabled || !videoElement || !canvasElement || !videoElement.videoWidth)
			return;
		const width = Math.min(384, videoElement.videoWidth);
		const height = Math.round((videoElement.videoHeight / videoElement.videoWidth) * width);
		canvasElement.width = width;
		canvasElement.height = height;
		const context = canvasElement.getContext('2d');
		if (!context) return;
		context.drawImage(videoElement, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvasElement.toBlob(resolve, 'image/jpeg', 0.65)
		);
		if (blob) agent.setImage({ kind: 'blob', blob, mimeType: 'image/jpeg' });
	}

	function handleAgentEvent(event: RemoteRealtimeEvent) {
		if (event.type === 'speech') {
			if (event.speaker === 'user') {
				phase = event.active ? 'user-speaking' : 'thinking';
			} else {
				phase = event.active ? 'speaking' : 'listening';
			}
			return;
		}
		if (event.type === 'transcript') {
			updateTranscript(event);
			return;
		}
		if (event.type === 'audio') {
			player?.enqueue(event.frame);
			return;
		}
		if (event.type === 'interrupted') {
			player?.clear();
			return;
		}
		if (event.type === 'latency') {
			if (event.stage === 'stt_final') sttFinalMs = event.milliseconds;
			if (event.stage === 'input_ready') inputReadyMs = event.milliseconds;
			if (event.stage === 'llm_first_token') llmFirstTokenMs = event.milliseconds;
			if (event.stage === 'tts_input') ttsInputMs = event.milliseconds;
			if (event.stage === 'tts_first_audio') ttsFirstAudioMs = event.milliseconds;
			if (event.stage === 'turn_complete') turnCompleteMs = event.milliseconds;
			return;
		}
		if (event.type === 'turn_complete') phase = 'listening';
		if (event.type === 'error') {
			reportError('Provider error', event.error);
			if (phase !== 'disconnected') phase = 'listening';
		}
	}

	function updateTranscript(event: Extract<RemoteRealtimeEvent, { type: 'transcript' }>) {
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
			clearError();
			phase = 'thinking';
			resetLatency();
		}
	}

	async function sendTypedMessage(event: SubmitEvent) {
		event.preventDefault();
		const text = textInput.trim();
		if (!text || !agent) return;
		textInput = '';
		clearError();
		resetLatency();
		phase = 'thinking';
		try {
			await agent.sendText(text);
		} catch (sendError) {
			if (!error) reportError('Pipeline error', sendError);
			phase = 'listening';
		}
	}

	function selectLlmProvider(provider: ProviderId) {
		secrets.setSecrets({ ...secrets.values, LLM_PROVIDER: provider });
	}

	function selectLlmModel(model: string) {
		secrets.setSecrets({
			...secrets.values,
			[llmProviderConfig.modelStorageKey]: model.trim()
		});
	}

	function selectSttModel(model: string) {
		sttModel = model;
		saveRealtimeSetting(`REALTIME_${sttProvider.toUpperCase()}_STT_MODEL`, model);
	}

	function selectSttProvider(provider: SttProvider) {
		applySttProvider(provider, true);
	}

	function applySttProvider(provider: SttProvider, persist: boolean) {
		sttProvider = provider;
		sttModel =
			secrets.values[`REALTIME_${provider.toUpperCase()}_STT_MODEL`]?.trim() ||
			speechConfig.stt[provider].model;
		if (persist) saveRealtimeSetting('REALTIME_STT_PROVIDER', provider);
	}

	function selectTtsProvider(provider: TtsProvider) {
		applyTtsProvider(provider, true);
		if (provider === 'elevenlabs') void loadElevenLabsVoices();
	}

	function applyTtsProvider(provider: TtsProvider, persist: boolean) {
		ttsProvider = provider;
		const prefix = provider === 'elevenlabs' ? 'ELEVENLABS' : 'OPENAI';
		const providerConfig = speechConfig.tts[provider];
		ttsModel = secrets.values[`REALTIME_${prefix}_TTS_MODEL`]?.trim() || providerConfig.model;
		voice = secrets.values[`REALTIME_${prefix}_TTS_VOICE`]?.trim() || providerConfig.voice;
		if (persist) saveRealtimeSetting('REALTIME_TTS_PROVIDER', provider);
	}

	function selectTtsModel(model: string) {
		ttsModel = model;
		const prefix = ttsProvider === 'elevenlabs' ? 'ELEVENLABS' : 'OPENAI';
		saveRealtimeSetting(`REALTIME_${prefix}_TTS_MODEL`, model);
	}

	function selectVoice(nextVoice: string) {
		voice = nextVoice;
		const prefix = ttsProvider === 'elevenlabs' ? 'ELEVENLABS' : 'OPENAI';
		saveRealtimeSetting(`REALTIME_${prefix}_TTS_VOICE`, nextVoice);
	}

	function saveRealtimeSetting(key: string, value: string) {
		secrets.setSecrets({ ...secrets.values, [key]: value.trim() });
	}

	async function loadElevenLabsVoices() {
		if (loadingVoices || elevenLabsVoices.length || !speechConfig.tts.elevenlabs.configured) return;
		loadingVoices = true;
		voiceLoadError = '';
		try {
			const response = await fetch('/api/speech/voices?provider=elevenlabs');
			const body = (await response.json()) as { voices?: VoiceOption[]; error?: string };
			if (!response.ok) throw new Error(body.error || 'Could not load ElevenLabs voices');
			elevenLabsVoices = body.voices ?? [];
			if (!voice && elevenLabsVoices[0]) selectVoice(elevenLabsVoices[0].id);
		} catch (loadError) {
			voiceLoadError = errorMessage(loadError);
		} finally {
			loadingVoices = false;
		}
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
		sttFinalMs = undefined;
		inputReadyMs = undefined;
		llmFirstTokenMs = undefined;
		ttsInputMs = undefined;
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
			const sample = Math.max(
				-1,
				Math.min(1, input[left] * (1 - fraction) + input[right] * fraction)
			);
			output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
		}
		return output;
	}

	function errorMessage(value: unknown): string {
		return value instanceof Error ? value.message : 'Something went wrong';
	}

	function reportError(source: string, value: unknown): void {
		errorSource = source;
		error = errorMessage(value);
	}

	function clearError(): void {
		errorSource = '';
		error = '';
	}

	function llmConfigurationHint(provider: ProviderId, label: string): string {
		if (provider === 'ollama') return 'Start Ollama where the playground server can reach it.';
		if (provider === 'openai-compatible') {
			return 'Add OPENAI_COMPATIBLE_BASE_URL to .env for the OpenAI-compatible server.';
		}
		const environmentKey = speechConfig.llm[provider]?.environmentKey;
		return environmentKey
			? `Add ${environmentKey} to .env for ${label}.`
			: `Configure ${label} in the server environment.`;
	}

	function llmConfigurationStatus(provider: ProviderId): string {
		if (provider === 'ollama') return 'Server-local Ollama';
		if (provider === 'openai-compatible') {
			return 'OPENAI_COMPATIBLE_BASE_URL from server environment';
		}
		const environmentKey = speechConfig.llm[provider]?.environmentKey;
		return providerReady && environmentKey
			? `${environmentKey} from server environment`
			: llmConfigurationHint(provider, providerName);
	}

	function isSttProvider(value: string | undefined): value is SttProvider {
		return value === 'openai' || value === 'deepgram' || value === 'elevenlabs';
	}

	function sttEnvironmentKey(provider: SttProvider): string {
		if (provider === 'deepgram') return 'DEEPGRAM_API_KEY';
		if (provider === 'elevenlabs') return 'ELEVENLABS_API_KEY';
		return 'OPENAI_API_KEY';
	}

	function phaseLabel(value: Phase): string {
		return value.replace('-', ' ');
	}

	function formatDuration(milliseconds: number): string {
		if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
		return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)}s`;
	}
</script>

<div class="min-h-screen bg-neutral-50 text-neutral-900">
	<main class="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Realtime agent</h1>
			<p class="mt-1 text-sm text-neutral-500">
				Configure and compare each stage of the voice cascade.
			</p>
		</div>

		<section class="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
			<div class="border-b border-neutral-200 px-4 py-3 sm:px-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-sm font-semibold text-neutral-900">Pipeline</h2>
						<p class="mt-0.5 text-xs text-neutral-500">Selections are locked while connected.</p>
					</div>
					<span
						class={`rounded-full px-2.5 py-1 text-xs ${canConnect ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
					>
						{canConnect ? 'Ready' : 'Configuration needed'}
					</span>
				</div>
			</div>

			<div class="grid divide-y divide-neutral-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
				<div class="p-4 sm:p-5">
					<div class="flex items-start justify-between gap-3">
						<div>
							<div class="text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
								1 · Input
							</div>
							<h3 class="mt-1 text-sm font-semibold">Speech to text</h3>
						</div>
						<span
							class={`mt-0.5 h-2.5 w-2.5 rounded-full ${sttReady ? 'bg-emerald-500' : 'bg-amber-400'}`}
							title={sttReady ? 'Configured' : 'Missing server key'}
						></span>
					</div>
					<label
						for="realtime-stt-provider"
						class="mt-4 block text-[11px] font-medium text-neutral-500">Provider</label
					>
					<select
						id="realtime-stt-provider"
						value={sttProvider}
						onchange={(event) =>
							selectSttProvider((event.currentTarget as HTMLSelectElement).value as SttProvider)}
						disabled={phase !== 'disconnected'}
						class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
					>
						<option value="openai" disabled={!speechConfig.stt.openai.configured}
							>OpenAI Realtime</option
						>
						<option value="deepgram" disabled={!speechConfig.stt.deepgram.configured}
							>Deepgram Flux</option
						>
						<option value="elevenlabs" disabled={!speechConfig.stt.elevenlabs.configured}
							>ElevenLabs Scribe</option
						>
					</select>
					<label
						for="realtime-stt-model"
						class="mt-3 block text-[11px] font-medium text-neutral-500">Model</label
					>
					<input
						id="realtime-stt-model"
						list="realtime-stt-model-options"
						value={sttModel}
						onchange={(event) => selectSttModel((event.currentTarget as HTMLInputElement).value)}
						disabled={phase !== 'disconnected'}
						class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
					/>
					<datalist id="realtime-stt-model-options">
						{#if sttProvider === 'openai'}
							<option value="gpt-4o-mini-transcribe"></option>
							<option value="gpt-4o-transcribe"></option>
						{:else if sttProvider === 'deepgram'}
							<option value="flux-general-en"></option>
							<option value="flux-general-multi"></option>
						{:else}
							<option value="scribe_v2_realtime"></option>
						{/if}
					</datalist>
					<p class="mt-3 text-[11px] text-neutral-500">
						{sttReady
							? `${sttEnvironmentKey(sttProvider)} from server environment`
							: `Add ${sttEnvironmentKey(sttProvider)} to .env`}
					</p>
				</div>

				<div class="p-4 sm:p-5">
					<div class="flex items-start justify-between gap-3">
						<div>
							<div class="text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
								2 · Reason
							</div>
							<h3 class="mt-1 text-sm font-semibold">Language model</h3>
						</div>
						<span
							class={`mt-0.5 h-2.5 w-2.5 rounded-full ${providerReady ? 'bg-emerald-500' : 'bg-amber-400'}`}
							title={providerReady ? 'Configured on server' : 'Missing server configuration'}
						></span>
					</div>
					<label
						for="realtime-llm-provider"
						class="mt-4 block text-[11px] font-medium text-neutral-500">Provider</label
					>
					<select
						id="realtime-llm-provider"
						value={llmProviderId}
						onchange={(event) =>
							selectLlmProvider((event.currentTarget as HTMLSelectElement).value as ProviderId)}
						disabled={phase !== 'disconnected'}
						class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
					>
						{#each providerConfigs as provider}
							<option
								value={provider.id}
								disabled={speechConfigLoaded && !speechConfig.llm[provider.id]?.configured}
								>{provider.label}{speechConfig.llm[provider.id]?.configured ? ' ✓' : ''}</option
							>
						{/each}
					</select>
					<label
						for="realtime-llm-model"
						class="mt-3 block text-[11px] font-medium text-neutral-500">Model</label
					>
					{#if llmModels.length}
						<select
							id="realtime-llm-model"
							value={modelName}
							onchange={(event) => selectLlmModel((event.currentTarget as HTMLSelectElement).value)}
							disabled={phase !== 'disconnected'}
							class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
						>
							{#if !selectedLlmModelIsInCatalog && modelName}
								<option value={modelName}>{modelName} (custom)</option>
							{/if}
							{#each llmModels as model}
								<option value={model.id}>{model.name}</option>
							{/each}
						</select>
					{:else}
						<input
							id="realtime-llm-model"
							value={modelName}
							onchange={(event) => selectLlmModel((event.currentTarget as HTMLInputElement).value)}
							disabled={phase !== 'disconnected'}
							class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
						/>
					{/if}
					<p class="mt-3 text-[11px] text-neutral-500">
						{llmConfigurationStatus(llmProviderId)}
					</p>
				</div>

				<div class="p-4 sm:p-5">
					<div class="flex items-start justify-between gap-3">
						<div>
							<div class="text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
								3 · Output
							</div>
							<h3 class="mt-1 text-sm font-semibold">Text to speech</h3>
						</div>
						<span
							class={`mt-0.5 h-2.5 w-2.5 rounded-full ${ttsReady ? 'bg-emerald-500' : 'bg-amber-400'}`}
							title={ttsReady ? 'Configured' : 'Missing server configuration'}
						></span>
					</div>
					<label for="realtime-tts" class="mt-4 block text-[11px] font-medium text-neutral-500"
						>Provider</label
					>
					<select
						id="realtime-tts"
						value={ttsProvider}
						onchange={(event) =>
							selectTtsProvider((event.currentTarget as HTMLSelectElement).value as TtsProvider)}
						disabled={phase !== 'disconnected'}
						class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
					>
						<option value="openai" disabled={!speechConfig.tts.openai.configured}>OpenAI</option>
						<option value="elevenlabs" disabled={!speechConfig.tts.elevenlabs.configured}
							>ElevenLabs</option
						>
					</select>
					<div class="mt-3 grid grid-cols-2 gap-2">
						<div>
							<label for="realtime-tts-model" class="block text-[11px] font-medium text-neutral-500"
								>Model</label
							>
							<input
								id="realtime-tts-model"
								value={ttsModel}
								onchange={(event) =>
									selectTtsModel((event.currentTarget as HTMLInputElement).value)}
								disabled={phase !== 'disconnected'}
								class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
							/>
						</div>
						<div>
							<label for="realtime-tts-voice" class="block text-[11px] font-medium text-neutral-500"
								>Voice</label
							>
							{#if ttsProvider === 'elevenlabs' && elevenLabsVoices.length}
								<select
									id="realtime-tts-voice"
									value={voice}
									onchange={(event) =>
										selectVoice((event.currentTarget as HTMLSelectElement).value)}
									disabled={phase !== 'disconnected'}
									class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
								>
									{#if voice && !elevenLabsVoices.some((option) => option.id === voice)}
										<option value={voice}>{voice}</option>
									{/if}
									{#each elevenLabsVoices as option}
										<option value={option.id}>{option.name}</option>
									{/each}
								</select>
							{:else}
								<input
									id="realtime-tts-voice"
									value={voice}
									onchange={(event) => selectVoice((event.currentTarget as HTMLInputElement).value)}
									disabled={phase !== 'disconnected'}
									placeholder={ttsProvider === 'elevenlabs' ? 'Voice ID' : 'coral'}
									class="mt-1 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
								/>
							{/if}
						</div>
					</div>
					<p class="mt-3 text-[11px] text-neutral-500">
						{#if ttsProvider === 'elevenlabs'}
							{loadingVoices
								? 'Loading voices…'
								: voiceLoadError ||
									(speechConfig.tts.elevenlabs.configured
										? 'ELEVENLABS_API_KEY from server environment'
										: 'Add ELEVENLABS_API_KEY to .env')}
						{:else}
							{speechConfig.tts.openai.configured
								? 'OPENAI_API_KEY from server environment'
								: 'Add OPENAI_API_KEY to .env'}
						{/if}
					</p>
				</div>
			</div>
		</section>

		<section class="mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
			<div class="grid gap-0 md:grid-cols-[minmax(0,1fr)_300px]">
				<div class="flex min-h-[420px] flex-col p-5">
					<div class="flex flex-wrap items-center gap-2 text-xs">
						<span
							class={`rounded-full px-2.5 py-1 ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}
						>
							{phaseLabel(phase)}
						</span>
						<span class="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600"
							>STT: {sttProvider} / {sttModel}</span
						>
						<span class="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600"
							>LLM: {providerName} / {modelName}</span
						>
						<span class="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600"
							>TTS: {ttsProvider} / {ttsModel}</span
						>
					</div>

					<div class="mt-5 flex-1 space-y-3 overflow-y-auto">
						{#if transcripts.length === 0}
							<div
								class="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500"
							>
								Connect, then speak naturally. Ask about what the camera sees or use the text box.
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

					<form class="mt-5 flex gap-2" onsubmit={sendTypedMessage}>
						<input
							bind:value={textInput}
							disabled={!connected}
							placeholder="Type while connected…"
							class="min-w-0 flex-1 rounded-full border-neutral-300 px-4 py-2 text-sm focus:border-neutral-500 focus:ring-neutral-500 disabled:bg-neutral-50"
						/>
						<button
							type="submit"
							disabled={!connected || !textInput.trim()}
							class="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
							>Send</button
						>
					</form>
				</div>

				<aside class="border-t border-neutral-200 bg-neutral-50 p-5 md:border-t-0 md:border-l">
					<div class="relative aspect-video overflow-hidden rounded-xl bg-neutral-900">
						<video
							bind:this={videoElement}
							muted
							playsinline
							class={`h-full w-full object-cover ${cameraEnabled && connected ? '' : 'hidden'}`}
						></video>
						{#if !cameraEnabled || !connected}
							<div class="absolute inset-0 grid place-items-center text-xs text-neutral-400">
								Camera preview
							</div>
						{/if}
					</div>
					<canvas bind:this={canvasElement} class="hidden"></canvas>

					<div class="mt-5 space-y-3">
						<label class="flex items-center justify-between gap-3 text-sm text-neutral-700">
							<span>Camera context <span class="text-neutral-400">(slower)</span></span>
							<input
								type="checkbox"
								bind:checked={cameraEnabled}
								disabled={phase !== 'disconnected'}
								class="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
							/>
						</label>
						<label class="flex items-center justify-between gap-3 text-sm text-neutral-700">
							<span>Microphone</span>
							<input
								type="checkbox"
								bind:checked={microphoneEnabled}
								disabled={phase !== 'disconnected'}
								class="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
							/>
						</label>
					</div>

					<div class="mt-5 rounded-xl bg-white p-3">
						<div class="flex items-center justify-between gap-3 text-xs">
							<span class="font-medium text-neutral-700">Turn timeline</span>
							<span class="font-mono text-[10px] text-neutral-500">
								{#if ttsFirstAudioMs !== undefined}
									{formatDuration((sttFinalMs ?? 0) + ttsFirstAudioMs)} audio ·
								{/if}
								{timelineParts.length ? `${formatDuration(timelineTotalMs)} total` : '—'}
							</span>
						</div>
						{#if timelineParts.length}
							<div class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
								{#each timelineParts as part}
									<div
										class="min-w-px"
										class:bg-amber-400={part.tone === 'stt'}
										class:bg-sky-400={part.tone === 'input'}
										class:bg-indigo-500={part.tone === 'llm'}
										class:bg-violet-400={part.tone === 'tts'}
										class:bg-emerald-400={part.tone === 'finish'}
										style={`flex-grow: ${Math.max(part.milliseconds, 1)}; flex-basis: 0`}
										title={`${part.label}: ${formatDuration(part.milliseconds)}`}
									></div>
								{/each}
							</div>
							<div class="mt-3 space-y-1.5">
								{#each timelineParts as part}
									<div class="flex items-center gap-2 text-[11px]" title={part.description}>
										<span
											class="h-2 w-2 shrink-0 rounded-full"
											class:bg-amber-400={part.tone === 'stt'}
											class:bg-sky-400={part.tone === 'input'}
											class:bg-indigo-500={part.tone === 'llm'}
											class:bg-violet-400={part.tone === 'tts'}
											class:bg-emerald-400={part.tone === 'finish'}
										></span>
										<span class="min-w-0 flex-1 truncate text-neutral-600">{part.label}</span>
										<span class="font-mono text-neutral-700"
											>{formatDuration(part.milliseconds)}</span
										>
									</div>
								{/each}
							</div>
							<p class="mt-2 text-[10px] leading-snug text-neutral-400">
								Wall-clock intervals; LLM generation and TTS overlap after audio starts.
							</p>
						{:else}
							<p class="mt-3 text-[11px] text-neutral-400">Speak or type to measure a turn.</p>
						{/if}
					</div>

					<div class="mt-5">
						{#if connected || phase === 'connecting'}
							<button
								type="button"
								onclick={disconnect}
								class="w-full rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-100"
								>Disconnect</button
							>
						{:else}
							<button
								type="button"
								onclick={connect}
								disabled={!canConnect}
								class="w-full rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
								>Connect</button
							>
						{/if}
					</div>
				</aside>
			</div>
		</section>

		{#if error}
			<div
				class="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800"
				role="alert"
				aria-live="assertive"
			>
				<p class="font-medium">{errorSource || 'Error'}</p>
				<p class="mt-0.5 break-words">{error}</p>
			</div>
		{/if}
		{#if !canConnect}
			<p class="mt-4 text-xs leading-relaxed text-neutral-500">
				{configurationHint}
			</p>
		{/if}
		<p class="mt-3 text-xs leading-relaxed text-neutral-500">
			This experiment keeps STT, LLM, and TTS credentials on the server. Its streaming HTTP
			transport is only a playground adapter; production apps can feed the same agent pipeline from
			WebRTC directly. Headphones give the cleanest interruption behavior.
		</p>
	</main>
</div>
