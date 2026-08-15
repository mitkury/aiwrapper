<script lang="ts">
	import { onMount } from 'svelte';

	type ProviderConfig = {
		openai: boolean;
		elevenlabs: boolean;
		elevenLabsVoiceId: string;
	};
	type Phase = 'idle' | 'recording' | 'transcribing' | 'speaking';

	let config = $state<ProviderConfig>({
		openai: false,
		elevenlabs: false,
		elevenLabsVoiceId: ''
	});
	let phase = $state<Phase>('idle');
	let transcript = $state('');
	let ttsProvider = $state<'openai' | 'elevenlabs'>('openai');
	let voice = $state('coral');
	let error = $state('');
	let recordingSeconds = $state(0);
	let audioPlaying = $state(false);

	let microphoneStream: MediaStream | undefined;
	let recordingContext: AudioContext | undefined;
	let recordingSource: MediaStreamAudioSourceNode | undefined;
	let recordingProcessor: ScriptProcessorNode | undefined;
	let recordingGain: GainNode | undefined;
	let recordingChunks: Int16Array[] = [];
	let recordingSampleRate = 0;
	let recordingStartedAt = 0;
	let recordingTimer: ReturnType<typeof setInterval> | undefined;
	let playbackContext: AudioContext | undefined;
	let playbackSource: AudioBufferSourceNode | undefined;
	let activeRequest: AbortController | undefined;

	onMount(() => {
		void loadConfig();
		return () => {
			activeRequest?.abort();
			void stopRecorderResources();
			stopPlayback();
		};
	});

	async function loadConfig() {
		try {
			const response = await fetch('/api/speech/config');
			if (!response.ok) throw new Error('Could not load speech configuration');
			config = (await response.json()) as ProviderConfig;
			if (!config.openai && config.elevenlabs) {
				ttsProvider = 'elevenlabs';
				voice = config.elevenLabsVoiceId;
			}
		} catch (loadError) {
			error = errorMessage(loadError);
		}
	}

	async function startRecording() {
		error = '';
		transcript = '';
		stopPlayback();
		activeRequest?.abort();
		recordingChunks = [];

		try {
			microphoneStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				}
			});
			recordingContext = new AudioContext();
			recordingSampleRate = recordingContext.sampleRate;
			recordingSource = recordingContext.createMediaStreamSource(microphoneStream);
			recordingProcessor = recordingContext.createScriptProcessor(4096, 1, 1);
			recordingGain = recordingContext.createGain();
			recordingGain.gain.value = 0;
			recordingProcessor.onaudioprocess = (event) => {
				if (phase !== 'recording') return;
				recordingChunks.push(floatToPcm(event.inputBuffer.getChannelData(0)));
			};
			recordingSource.connect(recordingProcessor);
			recordingProcessor.connect(recordingGain);
			recordingGain.connect(recordingContext.destination);

			recordingStartedAt = Date.now();
			recordingSeconds = 0;
			phase = 'recording';
			recordingTimer = setInterval(() => {
				recordingSeconds = (Date.now() - recordingStartedAt) / 1000;
			}, 100);
		} catch (recordingError) {
			await stopRecorderResources();
			phase = 'idle';
			error = errorMessage(recordingError);
		}
	}

	async function stopAndTranscribe() {
		if (phase !== 'recording') return;
		phase = 'transcribing';
		const samples = concatenate(recordingChunks);
		const sampleRate = recordingSampleRate;
		await stopRecorderResources();

		if (samples.length === 0) {
			phase = 'idle';
			error = 'The microphone did not produce any audio.';
			return;
		}

		const controller = new AbortController();
		activeRequest = controller;
		try {
			const response = await fetch('/api/speech/transcribe', {
				method: 'POST',
				headers: {
					'Content-Type': 'audio/pcm',
					'X-Audio-Sample-Rate': String(sampleRate)
				},
				body: pcmToBytes(samples),
				signal: controller.signal
			});
			const result = (await response.json()) as { text?: string; error?: string };
			if (!response.ok) throw new Error(result.error || 'Transcription failed');
			transcript = result.text ?? '';
		} catch (transcriptionError) {
			if (!controller.signal.aborted) error = errorMessage(transcriptionError);
		} finally {
			if (activeRequest === controller) activeRequest = undefined;
			phase = 'idle';
		}
	}

	async function speak() {
		const text = transcript.trim();
		if (!text) return;
		error = '';
		stopPlayback();
		activeRequest?.abort();
		const controller = new AbortController();
		activeRequest = controller;
		phase = 'speaking';

		try {
			const response = await fetch('/api/speech/speak', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider: ttsProvider, text, voice }),
				signal: controller.signal
			});
			if (!response.ok) {
				const result = (await response.json()) as { error?: string };
				throw new Error(result.error || 'Speech generation failed');
			}

			const sampleRate = Number(response.headers.get('x-audio-sample-rate'));
			await playPcm(await response.arrayBuffer(), sampleRate);
		} catch (speechError) {
			if (!controller.signal.aborted) error = errorMessage(speechError);
		} finally {
			if (activeRequest === controller) activeRequest = undefined;
			phase = 'idle';
		}
	}

	function cancel() {
		activeRequest?.abort();
		activeRequest = undefined;
		stopPlayback();
		phase = 'idle';
	}

	async function stopRecorderResources() {
		if (recordingTimer) clearInterval(recordingTimer);
		recordingTimer = undefined;
		recordingProcessor?.disconnect();
		recordingSource?.disconnect();
		recordingGain?.disconnect();
		microphoneStream?.getTracks().forEach((track) => track.stop());
		if (recordingContext && recordingContext.state !== 'closed') {
			await recordingContext.close();
		}
		microphoneStream = undefined;
		recordingContext = undefined;
		recordingSource = undefined;
		recordingProcessor = undefined;
		recordingGain = undefined;
	}

	async function playPcm(bytes: ArrayBuffer, sampleRate: number) {
		if (!Number.isFinite(sampleRate) || sampleRate <= 0 || bytes.byteLength % 2 !== 0) {
			throw new Error('The server returned an invalid PCM response');
		}
		const context = new AudioContext();
		const view = new DataView(bytes);
		const buffer = context.createBuffer(1, bytes.byteLength / 2, sampleRate);
		const channel = buffer.getChannelData(0);
		for (let index = 0; index < channel.length; index++) {
			channel[index] = view.getInt16(index * 2, true) / 32768;
		}
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		source.onended = () => {
			if (playbackSource !== source) return;
			source.disconnect();
			if (context.state !== 'closed') void context.close();
			playbackSource = undefined;
			playbackContext = undefined;
			audioPlaying = false;
		};
		playbackContext = context;
		playbackSource = source;
		source.start();
		audioPlaying = true;
	}

	function stopPlayback() {
		try {
			playbackSource?.stop();
		} catch {
			// The source may already have ended.
		}
		playbackSource?.disconnect();
		if (playbackContext && playbackContext.state !== 'closed') void playbackContext.close();
		playbackSource = undefined;
		playbackContext = undefined;
		audioPlaying = false;
	}

	function floatToPcm(input: Float32Array): Int16Array {
		const output = new Int16Array(input.length);
		for (let index = 0; index < input.length; index++) {
			const sample = Math.max(-1, Math.min(1, input[index]));
			output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
		}
		return output;
	}

	function concatenate(chunks: readonly Int16Array[]): Int16Array {
		const output = new Int16Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
		let offset = 0;
		for (const chunk of chunks) {
			output.set(chunk, offset);
			offset += chunk.length;
		}
		return output;
	}

	function pcmToBytes(samples: Int16Array): ArrayBuffer {
		const bytes = new ArrayBuffer(samples.length * 2);
		const view = new DataView(bytes);
		for (let index = 0; index < samples.length; index++) {
			view.setInt16(index * 2, samples[index], true);
		}
		return bytes;
	}

	function errorMessage(value: unknown): string {
		return value instanceof Error ? value.message : 'Something went wrong';
	}

	function selectProvider(provider: 'openai' | 'elevenlabs') {
		ttsProvider = provider;
		voice = provider === 'elevenlabs' ? config.elevenLabsVoiceId : 'coral';
	}
</script>

<div class="min-h-screen bg-neutral-50 text-neutral-900">
	<main class="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
		<div>
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Speech playground</h1>
				<p class="mt-1 text-sm text-neutral-500">Record → transcribe → edit → speak</p>
			</div>
		</div>

		<section class="mt-8 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
			<div class="flex flex-wrap items-center gap-2 text-xs">
				<span
					class={`rounded-full px-2.5 py-1 ${config.openai ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}
				>
					OpenAI {config.openai ? 'ready' : 'not configured'}
				</span>
				<span
					class={`rounded-full px-2.5 py-1 ${config.elevenlabs ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}
				>
					ElevenLabs {config.elevenlabs ? 'ready' : 'not configured'}
				</span>
			</div>

			<div class="mt-6 flex items-center gap-3">
				{#if phase === 'recording'}
					<button
						type="button"
						onclick={stopAndTranscribe}
						class="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
					>
						Stop & transcribe
					</button>
					<span class="font-mono text-sm text-red-700">● {recordingSeconds.toFixed(1)}s</span>
				{:else}
					<button
						type="button"
						onclick={startRecording}
						disabled={phase !== 'idle' || !config.openai}
						class="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{phase === 'transcribing' ? 'Transcribing…' : 'Record'}
					</button>
				{/if}
				{#if phase === 'transcribing' || phase === 'speaking'}
					<button
						type="button"
						onclick={cancel}
						class="text-sm text-neutral-500 hover:text-neutral-900"
					>
						Cancel
					</button>
				{/if}
			</div>

			<label class="mt-6 block text-sm font-medium text-neutral-700" for="transcript"
				>Transcript</label
			>
			<textarea
				id="transcript"
				bind:value={transcript}
				rows="6"
				placeholder="Your transcription will appear here. You can also type text directly."
				class="mt-2 w-full resize-y rounded-xl border-neutral-300 text-base leading-relaxed focus:border-neutral-500 focus:ring-neutral-500"
			></textarea>

			<div class="mt-5 grid gap-4 sm:grid-cols-2">
				<div>
					<label class="block text-sm font-medium text-neutral-700" for="tts-provider"
						>Voice provider</label
					>
					<select
						id="tts-provider"
						value={ttsProvider}
						onchange={(event) =>
							selectProvider(
								(event.currentTarget as HTMLSelectElement).value as 'openai' | 'elevenlabs'
							)}
						class="mt-2 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
					>
						<option value="openai" disabled={!config.openai}>OpenAI</option>
						<option value="elevenlabs" disabled={!config.elevenlabs}>ElevenLabs</option>
					</select>
				</div>
				<div>
					<label class="block text-sm font-medium text-neutral-700" for="voice">Voice</label>
					<input
						id="voice"
						bind:value={voice}
						class="mt-2 w-full rounded-lg border-neutral-300 text-sm focus:border-neutral-500 focus:ring-neutral-500"
						placeholder={ttsProvider === 'elevenlabs' ? 'ElevenLabs voice ID' : 'coral'}
					/>
				</div>
			</div>

			<div class="mt-5 flex items-center gap-3">
				<button
					type="button"
					onclick={speak}
					disabled={!transcript.trim() ||
						phase !== 'idle' ||
						(ttsProvider === 'openai' ? !config.openai : !config.elevenlabs)}
					class="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{phase === 'speaking' ? 'Generating…' : 'Generate & play'}
				</button>
				{#if audioPlaying}
					<button
						type="button"
						onclick={stopPlayback}
						class="text-sm text-neutral-500 hover:text-neutral-900">Stop audio</button
					>
				{/if}
			</div>

			{#if error}
				<p class="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
			{/if}
		</section>

		<p class="mt-4 text-xs leading-relaxed text-neutral-500">
			Keys stay on the SvelteKit server. Add <code>OPENAI_API_KEY</code>,
			<code>ELEVENLABS_API_KEY</code>, and <code>ELEVENLABS_VOICE_ID</code> to the repository
			<code>.env</code>. The development server reloads automatically when it changes.
		</p>
	</main>
</div>
