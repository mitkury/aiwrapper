<script lang="ts">
	import { onMount } from 'svelte';
	import { PcmStreamPlayer } from '$lib/realtime/pcm-player';
	import { resampleToPcm } from '$lib/realtime/pcm';
	import {
		RemoteSpeechToSpeechSession,
		type RemoteSpeechToSpeechEvent,
		type SpeechToSpeechProviderId
	} from '$lib/speech-to-speech/remote-speech-to-speech-session';
	import {
		updateSpeechToSpeechTranscripts,
		type SpeechToSpeechTranscriptEntry
	} from '$lib/speech-to-speech/transcript-list';
	import type { SpeechToSpeechTimelineStage } from '$lib/realtime/realtime-session-protocol';

	type ProviderConfig = {
		configured: boolean;
		model: string;
		voice: string;
	};
	type LiveConfig = Record<SpeechToSpeechProviderId, ProviderConfig>;
	type Phase = 'disconnected' | 'connecting' | 'listening' | 'thinking' | 'speaking';
	type TimelineEntry = {
		stage: Exclude<SpeechToSpeechTimelineStage, 'session-ready'>;
		milliseconds: number;
	};
	type TimelinePart = TimelineEntry & {
		label: string;
		description: string;
		duration: number;
		tone: 'input' | 'model' | 'audio' | 'tool' | 'finish' | 'error';
	};
	type ToolEntry = {
		callId: string;
		name: string;
		arguments: Record<string, unknown>;
		complete: boolean;
		result?: unknown;
	};

	let config = $state<LiveConfig>({
		openai: { configured: false, model: 'gpt-realtime-2.1', voice: 'marin' },
		gemini: { configured: false, model: 'gemini-3.1-flash-live-preview', voice: 'Kore' },
		xai: { configured: false, model: 'grok-voice-think-fast-2.0', voice: 'eve' },
		azure: { configured: false, model: 'gpt-realtime', voice: 'alloy' },
		nova: { configured: true, model: 'amazon.nova-2-sonic-v1:0', voice: 'tiffany' }
	});
	let configLoaded = $state(false);
	let provider = $state<SpeechToSpeechProviderId>('openai');
	let model = $state('gpt-realtime-2.1');
	let voice = $state('marin');
	let instructions = $state(
		'You are a concise live voice assistant. Reply naturally and keep spoken answers brief.'
	);
	let phase = $state<Phase>('disconnected');
	let transcripts: SpeechToSpeechTranscriptEntry[] = $state([]);
	let error = $state('');
	let sessionInputRate = $state<number | undefined>();
	let connectionMs = $state<number | undefined>();
	let timelineTurnId = $state(0);
	let timelineEntries: TimelineEntry[] = $state([]);
	let toolEntries: ToolEntry[] = $state([]);

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
	const timelineParts = $derived.by(() => {
		let previous = 0;
		return timelineEntries.map((entry) => {
			const details = timelineStageDetails(entry.stage);
			const part: TimelinePart = {
				...entry,
				...details,
				duration: Math.max(0, entry.milliseconds - previous)
			};
			previous = entry.milliseconds;
			return part;
		});
	});
	const timelineTotalMs = $derived(timelineEntries.at(-1)?.milliseconds ?? 0);

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
					: config.xai.configured
						? 'xai'
						: config.azure.configured
							? 'azure'
							: config.nova.configured
								? 'nova'
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

	function providerLabel(value: SpeechToSpeechProviderId): string {
		if (value === 'openai') return 'OpenAI Realtime';
		if (value === 'gemini') return 'Gemini Live';
		if (value === 'xai') return 'xAI Voice';
		if (value === 'azure') return 'Azure Voice Live';
		return 'Amazon Nova Sonic';
	}

	function providerEnvironmentKey(value: SpeechToSpeechProviderId): string {
		if (value === 'openai') return 'OPENAI_API_KEY';
		if (value === 'gemini') return 'GOOGLE_API_KEY';
		if (value === 'xai') return 'XAI_API_KEY';
		if (value === 'azure') return 'AZURE_VOICE_LIVE_ENDPOINT and credentials';
		return 'AWS credential chain';
	}

	async function connect() {
		if (!canConnect || phase !== 'disconnected') return;
		error = '';
		transcripts = [];
		connectionMs = undefined;
		timelineTurnId = 0;
		timelineEntries = [];
		toolEntries = [];
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
		if (event.type === 'timeline') {
			if (event.stage === 'session-ready') {
				connectionMs = event.milliseconds;
				return;
			}
			if (event.turnId !== timelineTurnId) {
				timelineTurnId = event.turnId;
				timelineEntries = [];
			}
			const existing = timelineEntries.findIndex((entry) => entry.stage === event.stage);
			const entry = { stage: event.stage, milliseconds: event.milliseconds };
			if (existing === -1) timelineEntries = [...timelineEntries, entry];
			else timelineEntries = timelineEntries.with(existing, entry);
			return;
		}
		if (event.type === 'audio') {
			player?.enqueue(event.frame);
			return;
		}
		if (event.type === 'transcript') {
			updateTranscript(event);
			if (event.speaker === 'user') phase = 'thinking';
			return;
		}
		if (event.type === 'tool') {
			const index = toolEntries.findIndex((entry) => entry.callId === event.callId);
			if (event.phase === 'call') {
				const entry = {
					callId: event.callId,
					name: event.name,
					arguments: event.arguments,
					complete: false
				};
				toolEntries = index === -1 ? [...toolEntries, entry] : toolEntries.with(index, entry);
			} else if (index !== -1) {
				toolEntries = toolEntries.with(index, {
					...toolEntries[index],
					complete: true,
					result: event.result
				});
			} else {
				toolEntries = [
					...toolEntries,
					{
						callId: event.callId,
						name: event.name,
						arguments: {},
						complete: true,
						result: event.result
					}
				];
			}
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
		transcripts = updateSpeechToSpeechTranscripts(transcripts, event, ++transcriptId);
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

	function timelineStageDetails(stage: TimelineEntry['stage']): {
		label: string;
		description: string;
		tone: TimelinePart['tone'];
	} {
		if (stage === 'input-start') {
			return {
				label: 'Input heard',
				description: 'First normalized user transcript',
				tone: 'input'
			};
		}
		if (stage === 'input-final') {
			return {
				label: 'Input final',
				description: 'Provider finalized the user transcript',
				tone: 'input'
			};
		}
		if (stage === 'response-start') {
			return {
				label: 'Response start',
				description: 'Provider began a model response',
				tone: 'model'
			};
		}
		if (stage === 'first-text') {
			return {
				label: 'First text',
				description: 'First normalized response transcript',
				tone: 'model'
			};
		}
		if (stage === 'first-audio') {
			return { label: 'First audio', description: 'First playable PCM frame', tone: 'audio' };
		}
		if (stage === 'tool-call') {
			return { label: 'Tool call', description: 'Model requested a local tool', tone: 'tool' };
		}
		if (stage === 'tool-result') {
			return { label: 'Tool result', description: 'Local tool completed', tone: 'tool' };
		}
		if (stage === 'response-end') {
			return { label: 'Complete', description: 'Provider completed the turn', tone: 'finish' };
		}
		if (stage === 'response-interrupted') {
			return {
				label: 'Interrupted',
				description: 'User speech stopped the response',
				tone: 'finish'
			};
		}
		return { label: 'Error', description: 'Provider reported an error', tone: 'error' };
	}

	function formatDuration(milliseconds: number): string {
		return milliseconds < 1000
			? `${Math.round(milliseconds)} ms`
			: `${(milliseconds / 1000).toFixed(2)} s`;
	}

	function formatToolResult(result: unknown): string {
		return JSON.stringify(result) ?? 'undefined';
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
					<option value="xai" disabled={configLoaded && !config.xai.configured}>
						xAI Voice{config.xai.configured ? ' ✓' : ''}
					</option>
					<option value="azure" disabled={configLoaded && !config.azure.configured}>
						Azure Voice Live{config.azure.configured ? ' ✓' : ''}
					</option>
					<option value="nova" disabled={configLoaded && !config.nova.configured}>
						Amazon Nova 2 Sonic{config.nova.configured ? ' ✓' : ''}
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
					{:else if provider === 'gemini'}
						<option value="gemini-3.1-flash-live-preview"></option>
					{:else if provider === 'xai'}
						<option value="grok-voice-think-fast-2.0"></option>
						<option value="grok-voice-latest"></option>
						<option value="grok-voice-think-fast-1.0"></option>
					{:else if provider === 'azure'}
						<option value="gpt-realtime"></option>
						<option value="gpt-realtime-mini"></option>
						<option value="azure-realtime"></option>
						<option value="phi4-mm-realtime"></option>
					{:else}
						<option value="amazon.nova-2-sonic-v1:0"></option>
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
					{:else if provider === 'gemini'}
						<option value="Kore"></option>
						<option value="Puck"></option>
						<option value="Aoede"></option>
					{:else if provider === 'xai'}
						<option value="eve"></option>
						<option value="ara"></option>
						<option value="leo"></option>
						<option value="rex"></option>
						<option value="sal"></option>
					{:else if provider === 'azure'}
						<option value="alloy"></option>
						<option value="en-US-Ava:DragonHDLatestNeural"></option>
					{:else}
						<option value="tiffany"></option>
						<option value="matthew"></option>
						<option value="amy"></option>
						<option value="olivia"></option>
						<option value="lupe"></option>
						<option value="carlos"></option>
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
			{:else if provider === 'nova'}
				The server will use the standard AWS credential chain.
			{:else if selectedConfig.configured}
				{providerEnvironmentKey(provider)} is configured on the server.
			{:else}
				Add {providerEnvironmentKey(provider)} to the repository .env file.
			{/if}
		</p>
		<p class="mt-2 text-xs text-neutral-500">
			Every provider receives the same local <code>get_current_time</code> tool. Ask for the current time
			to test tool calling.
		</p>
	</section>

	{#if error}
		<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
			{error}
		</div>
	{/if}

	<section class="mt-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
		<div class="flex items-center justify-between gap-3 text-xs">
			<div>
				<span class="font-medium text-neutral-800">Live timeline</span>
				{#if timelineTurnId}
					<span class="ml-2 text-neutral-400">Turn {timelineTurnId}</span>
				{/if}
			</div>
			<div class="font-mono text-[10px] text-neutral-500">
				{#if connectionMs !== undefined}connected {formatDuration(connectionMs)}{/if}
				{#if connectionMs !== undefined && timelineParts.length}
					·
				{/if}
				{timelineParts.length ? `${formatDuration(timelineTotalMs)} turn` : ''}
			</div>
		</div>
		{#if timelineParts.length}
			<div class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
				{#each timelineParts as part}
					<div
						class="min-w-px"
						class:bg-amber-400={part.tone === 'input'}
						class:bg-indigo-500={part.tone === 'model'}
						class:bg-violet-400={part.tone === 'audio'}
						class:bg-cyan-400={part.tone === 'tool'}
						class:bg-emerald-400={part.tone === 'finish'}
						class:bg-red-400={part.tone === 'error'}
						style={`flex-grow: ${Math.max(part.duration, 1)}; flex-basis: 0`}
						title={`${part.label}: +${formatDuration(part.milliseconds)}`}
					></div>
				{/each}
			</div>
			<div class="mt-3 grid gap-1.5 sm:grid-cols-2">
				{#each timelineParts as part}
					<div class="flex items-center gap-2 text-[11px]" title={part.description}>
						<span
							class="h-2 w-2 shrink-0 rounded-full"
							class:bg-amber-400={part.tone === 'input'}
							class:bg-indigo-500={part.tone === 'model'}
							class:bg-violet-400={part.tone === 'audio'}
							class:bg-cyan-400={part.tone === 'tool'}
							class:bg-emerald-400={part.tone === 'finish'}
							class:bg-red-400={part.tone === 'error'}
						></span>
						<span class="min-w-0 flex-1 truncate text-neutral-600">{part.label}</span>
						<span class="font-mono text-neutral-700">+{formatDuration(part.milliseconds)}</span>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-[10px] leading-snug text-neutral-400">
				Provider-neutral server arrival times; transcript and audio generation can overlap.
			</p>
		{:else}
			<p class="mt-3 text-[11px] text-neutral-400">
				Connect and speak to record normalized request and response milestones.
			</p>
		{/if}
		{#if toolEntries.length}
			<div class="mt-4 space-y-2 border-t border-neutral-100 pt-4">
				{#each toolEntries as tool (tool.callId)}
					<div class="rounded-xl bg-cyan-50 px-3 py-2.5 text-xs text-cyan-950">
						<div class="flex items-center justify-between gap-3">
							<span class="font-medium">{tool.name}</span>
							<span class="text-[10px] text-cyan-700">
								{tool.complete ? 'Complete' : 'Running…'}
							</span>
						</div>
						<pre
							class="mt-1 overflow-x-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(
								tool.arguments
							)}{#if tool.complete}
								→ {formatToolResult(tool.result)}{/if}</pre>
					</div>
				{/each}
			</div>
		{/if}
	</section>

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
				{providerLabel(provider)} · {model}
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
