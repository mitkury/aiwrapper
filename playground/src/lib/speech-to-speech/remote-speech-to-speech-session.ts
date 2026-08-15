import type { PcmAudioFrame } from 'aiwrapper/unstable/speech';
import { encodeAudioPacket } from '$lib/realtime/audio-upload-protocol';
import { pcmSamplesToBytes } from '$lib/realtime/pcm';
import {
	RealtimeEventDecoder,
	type RealtimeServerError,
	type RealtimeServerEvent
} from '$lib/realtime/realtime-session-protocol';

export type SpeechToSpeechProviderId = 'openai' | 'gemini';

export type SpeechToSpeechSessionConfig = {
	provider: SpeechToSpeechProviderId;
	model: string;
	voice: string;
	instructions?: string;
};

export type RemoteSpeechToSpeechEvent =
	| Exclude<RealtimeServerEvent, { type: 'heartbeat' | 'error' }>
	| { type: 'audio'; frame: PcmAudioFrame }
	| { type: 'error'; error: Error };

export class RemoteSpeechToSpeechSession {
	private readonly listeners = new Set<(event: RemoteSpeechToSpeechEvent) => void>();
	private readonly eventsController = new AbortController();
	private sessionId?: string;
	private audioWriter?: WritableStreamDefaultWriter<Uint8Array>;
	private audioTail = Promise.resolve();
	private uploadCompletion = Promise.resolve();
	private eventsCompletion = Promise.resolve();
	private closed = false;
	private resolveConnected?: () => void;
	private rejectConnected?: (error: Error) => void;
	private readonly connected = new Promise<void>((resolve, reject) => {
		this.resolveConnected = resolve;
		this.rejectConnected = reject;
	});
	inputSampleRate = 24000;

	constructor(private readonly config: SpeechToSpeechSessionConfig) {}

	subscribe(listener: (event: RemoteSpeechToSpeechEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async connect(): Promise<void> {
		if (this.closed) throw new Error('Speech-to-speech session is closed');
		if (this.sessionId) throw new Error('Speech-to-speech session is already connected');
		const response = await fetch('/api/speech-to-speech/sessions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(this.config)
		});
		const body = (await response.json()) as {
			id?: string;
			inputSampleRate?: number;
			error?: string;
		};
		if (!response.ok || !body.id) {
			throw new Error(body.error || 'Could not start speech-to-speech session');
		}
		this.sessionId = body.id;
		this.inputSampleRate = body.inputSampleRate ?? 24000;
		this.eventsCompletion = this.consumeEvents();
		void this.eventsCompletion.catch((error) => this.fail(error));
		if (canStreamToCurrentOrigin()) {
			this.uploadCompletion = this.openAudioUpload();
			void this.uploadCompletion.catch((error) => this.fail(error));
		}
		await this.connected;
	}

	async sendAudio(frame: PcmAudioFrame): Promise<void> {
		const id = this.requireSession();
		if (this.closed) throw new Error('Speech-to-speech session is closed');
		if (
			frame.encoding !== 'pcm_s16le' ||
			frame.channels !== 1 ||
			frame.sampleRate !== this.inputSampleRate
		) {
			throw new Error(
				`Speech-to-speech input requires mono ${this.inputSampleRate} Hz signed 16-bit PCM`
			);
		}
		const bytes = pcmSamplesToBytes(frame.samples);
		if (this.audioWriter) {
			await this.audioWriter.write(encodeAudioPacket(bytes));
			return;
		}
		const next = this.audioTail.then(async () => {
			const response = await fetch(`/api/speech-to-speech/sessions/${encodeURIComponent(id)}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'audio/pcm',
					'X-Audio-Sample-Rate': String(this.inputSampleRate)
				},
				body: bytes.buffer as ArrayBuffer
			});
			if (!response.ok) throw new Error(await responseError(response, 'Could not send audio'));
		});
		this.audioTail = next.catch(() => undefined);
		await next;
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		const id = this.sessionId;
		this.sessionId = undefined;
		await this.audioTail;
		await this.audioWriter?.close().catch(() => undefined);
		await this.uploadCompletion.catch(() => undefined);
		if (id) {
			await fetch(`/api/speech-to-speech/sessions/${encodeURIComponent(id)}`, {
				method: 'DELETE'
			}).catch(() => undefined);
		}
		this.eventsController.abort();
		await this.eventsCompletion.catch(() => undefined);
		this.listeners.clear();
	}

	private async consumeEvents(): Promise<void> {
		const id = this.requireSession();
		const response = await fetch(`/api/speech-to-speech/sessions/${encodeURIComponent(id)}`, {
			headers: { Accept: 'application/x-aiwrapper-realtime-events' },
			signal: this.eventsController.signal
		});
		if (!response.ok || !response.body) {
			throw new Error(await responseError(response, 'Could not open speech-to-speech events'));
		}
		const decoder = new RealtimeEventDecoder();
		const reader = response.body.getReader();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				for (const packet of decoder.push(value)) {
					if (packet.type === 'audio') this.emit({ type: 'audio', frame: packet.frame });
					else this.handleServerEvent(packet.event);
				}
			}
			decoder.finish();
			if (!this.closed) throw new Error('Speech-to-speech event stream disconnected');
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	}

	private async openAudioUpload(): Promise<void> {
		const id = this.requireSession();
		const stream = new TransformStream<Uint8Array, Uint8Array>();
		this.audioWriter = stream.writable.getWriter();
		const response = await fetch(`/api/speech-to-speech/sessions/${encodeURIComponent(id)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-aiwrapper-audio-stream' },
			body: stream.readable,
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });
		if (!response.ok) throw new Error(await responseError(response, 'Audio stream failed'));
	}

	private handleServerEvent(event: RealtimeServerEvent): void {
		if (event.type === 'heartbeat') return;
		if (event.type === 'connected') this.resolveConnected?.();
		if (event.type === 'error') {
			this.emit({ type: 'error', error: serverError(event.error) });
			return;
		}
		this.emit(event);
	}

	private requireSession(): string {
		if (!this.sessionId) throw new Error('Speech-to-speech session is not connected');
		return this.sessionId;
	}

	private emit(event: RemoteSpeechToSpeechEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	private fail(value: unknown): void {
		if (this.closed || isAbortError(value)) return;
		const error = value instanceof Error ? value : new Error(String(value));
		this.rejectConnected?.(error);
		this.emit({ type: 'error', error });
	}
}

function serverError(error: RealtimeServerError): Error {
	return new Error(`${error.provider ? `${error.provider}: ` : ''}${error.message}`);
}

async function responseError(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: { message?: string } | string };
		if (typeof body.error === 'string') return body.error;
		return body.error?.message || fallback;
	} catch {
		return fallback;
	}
}

function canStreamToCurrentOrigin(): boolean {
	return location.protocol === 'https:' && supportsStreamingRequestBodies();
}

function supportsStreamingRequestBodies(): boolean {
	if (typeof ReadableStream === 'undefined' || typeof TransformStream === 'undefined') return false;
	let duplexRead = false;
	try {
		const request = new Request(location.href, {
			method: 'POST',
			body: new ReadableStream(),
			get duplex() {
				duplexRead = true;
				return 'half' as const;
			}
		} as RequestInit & { duplex: 'half' });
		return duplexRead && !request.headers.has('Content-Type');
	} catch {
		return false;
	}
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}
