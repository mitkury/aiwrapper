import type {
	PcmAudioFrame,
	SpeechToTextProvider,
	SpeechToTextSession,
	SpeechToTextSessionOptions,
	TextToSpeechOptions,
	TextToSpeechProvider,
	TranscriptionResult
} from 'aiwrapper/speech';

export class RemoteSpeechToText implements SpeechToTextProvider {
	readonly inputFormat = {
		encoding: 'pcm_s16le' as const,
		channels: 1 as const,
		sampleRate: 24000
	};
	constructor(private readonly model = '') {}

	async createSession(options: SpeechToTextSessionOptions = {}): Promise<SpeechToTextSession> {
		const response = await fetch('/api/realtime/stt', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: this.model }),
			signal: options.signal
		});
		const body = (await response.json()) as { id?: string; sampleRate?: number; error?: string };
		if (!response.ok || !body.id) throw new Error(body.error || 'Could not start transcription');
		const session = new RemoteSpeechToTextSession(body.id, options);
		try {
			await session.connect();
			return session;
		} catch (error) {
			await session.close();
			throw error;
		}
	}
}

class RemoteSpeechToTextSession implements SpeechToTextSession {
	private readonly events: EventSource;
	private audioTail = Promise.resolve();
	private closed = false;
	private resolveReady?: () => void;
	private rejectReady?: (error: Error) => void;
	private readonly ready = new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	});

	constructor(
		private readonly id: string,
		private readonly options: SpeechToTextSessionOptions
	) {
		this.events = new EventSource(`/api/realtime/stt/${encodeURIComponent(id)}`);
		this.events.onmessage = (message) => this.handleEvent(message.data);
		this.events.onerror = () => {
			if (this.closed) return;
			this.rejectReady?.(new Error('Realtime transcription event stream disconnected'));
		};
		options.signal?.addEventListener('abort', () => void this.close(), { once: true });
	}

	async connect(): Promise<void> {
		await this.ready;
	}

	appendAudio(frame: PcmAudioFrame): Promise<void> {
		if (this.closed) return Promise.reject(new Error('Realtime transcription session is closed'));
		if (frame.sampleRate !== 24000) {
			return Promise.reject(
				new Error(`Realtime transcription requires 24000 Hz PCM, received ${frame.sampleRate}`)
			);
		}
		const bytes = pcmBytes(frame.samples);
		const next = this.audioTail.then(async () => {
			const response = await fetch(`/api/realtime/stt/${encodeURIComponent(this.id)}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'audio/pcm',
					'X-Audio-Sample-Rate': '24000'
				},
				body: bytes.buffer as ArrayBuffer,
				signal: this.options.signal
			});
			if (!response.ok) throw new Error(await responseError(response, 'Could not stream audio'));
		});
		this.audioTail = next.catch(() => undefined);
		return next;
	}

	async commit(): Promise<TranscriptionResult> {
		await this.audioTail;
		const response = await fetch(`/api/realtime/stt/${encodeURIComponent(this.id)}/commit`, {
			method: 'POST',
			signal: this.options.signal
		});
		if (!response.ok) throw new Error(await responseError(response, 'Could not commit audio'));
		return (await response.json()) as TranscriptionResult;
	}

	async finish(): Promise<TranscriptionResult> {
		try {
			return await this.commit();
		} finally {
			await this.close();
		}
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.events.close();
		await this.audioTail;
		await fetch(`/api/realtime/stt/${encodeURIComponent(this.id)}`, {
			method: 'DELETE'
		}).catch(() => undefined);
	}

	private handleEvent(serialized: string): void {
		const event = JSON.parse(serialized) as {
			type: string;
			text?: string;
			final?: boolean;
			languages?: string[];
			active?: boolean;
			audioOffsetMs?: number;
		};
		if (event.type === 'ready') {
			this.resolveReady?.();
			return;
		}
		if (event.type === 'transcript' && event.text) {
			this.options.onTranscript?.(
				event.final
					? {
							type: 'final',
							text: event.text,
							...(event.languages ? { languages: event.languages } : {})
						}
					: { type: 'delta', text: event.text }
			);
			return;
		}
		if (event.type === 'speech' && event.active !== undefined) {
			this.options.onSpeechActivity?.({
				type: event.active ? 'start' : 'end',
				...(event.audioOffsetMs === undefined ? {} : { audioOffsetMs: event.audioOffsetMs })
			});
			return;
		}
	}
}

export class RemoteTextToSpeech implements TextToSpeechProvider {
	readonly outputFormat = {
		encoding: 'pcm_s16le' as const,
		channels: 1 as const,
		sampleRate: 24000
	};

	constructor(
		private readonly provider: 'openai' | 'elevenlabs',
		private readonly voice: string,
		private readonly model = ''
	) {}

	async *speak(text: string, options: TextToSpeechOptions = {}): AsyncIterable<PcmAudioFrame> {
		const response = await fetch('/api/speech/speak', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				provider: this.provider,
				text,
				voice: options.voice || this.voice,
				model: this.model
			}),
			signal: options.signal
		});
		if (!response.ok) throw new Error(await responseError(response, 'Speech generation failed'));
		if (!response.body) throw new Error('Speech response did not include audio');
		const sampleRate = Number(response.headers.get('x-audio-sample-rate'));
		if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
			throw new Error('Speech response did not include a valid sample rate');
		}
		const reader = response.body.getReader();
		let carry: number | undefined;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (!value?.length) continue;
				const combined = new Uint8Array(value.length + (carry === undefined ? 0 : 1));
				let offset = 0;
				if (carry !== undefined) combined[offset++] = carry;
				combined.set(value, offset);
				const usable = combined.length - (combined.length % 2);
				carry = usable < combined.length ? combined[combined.length - 1] : undefined;
				const samples = new Int16Array(usable / 2);
				const view = new DataView(combined.buffer, combined.byteOffset, usable);
				for (let index = 0; index < samples.length; index++) {
					samples[index] = view.getInt16(index * 2, true);
				}
				if (samples.length) yield { ...this.outputFormat, sampleRate, samples };
			}
			if (carry !== undefined)
				throw new Error('Speech response ended with an incomplete PCM sample');
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	}
}

function pcmBytes(samples: Int16Array): Uint8Array {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < samples.length; index++)
		view.setInt16(index * 2, samples[index], true);
	return bytes;
}

async function responseError(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string };
		return body.error || fallback;
	} catch {
		return fallback;
	}
}
