import type { PcmAudioFrame } from 'aiwrapper/speech';
import { encodeAudioPacket } from './audio-upload-protocol';
import {
	RealtimeEventDecoder,
	type RealtimeServerError,
	type RealtimeServerEvent,
	type RealtimeSessionConfig
} from './realtime-session-protocol';

export type RemoteRealtimeEvent =
	| Exclude<RealtimeServerEvent, { type: 'heartbeat' | 'error' }>
	| { type: 'audio'; frame: PcmAudioFrame }
	| { type: 'error'; error: Error };

export class RemoteRealtimeSession {
	private readonly listeners = new Set<(event: RemoteRealtimeEvent) => void>();
	private readonly eventsController = new AbortController();
	private sessionId?: string;
	private audioWriter?: WritableStreamDefaultWriter<Uint8Array>;
	private audioTail = Promise.resolve();
	private uploadCompletion = Promise.resolve();
	private eventsCompletion = Promise.resolve();
	private pendingImage?: { blob: Blob; mimeType: string };
	private imageTask?: Promise<void>;
	private closed = false;
	private resolveConnected?: () => void;
	private rejectConnected?: (error: Error) => void;
	private readonly connected = new Promise<void>((resolve, reject) => {
		this.resolveConnected = resolve;
		this.rejectConnected = reject;
	});

	constructor(private readonly config: RealtimeSessionConfig) {}

	subscribe(listener: (event: RemoteRealtimeEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async connect(): Promise<void> {
		if (this.closed) throw new Error('Realtime session is closed');
		if (this.sessionId) throw new Error('Realtime session is already connected');
		const response = await fetch('/api/realtime/sessions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(this.config)
		});
		const body = (await response.json()) as { id?: string; error?: string };
		if (!response.ok || !body.id) throw new Error(body.error || 'Could not start realtime session');
		this.sessionId = body.id;
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
		if (this.closed) throw new Error('Realtime session is closed');
		if (frame.encoding !== 'pcm_s16le' || frame.channels !== 1 || frame.sampleRate !== 24000) {
			throw new Error('Realtime input requires mono 24000 Hz signed 16-bit PCM');
		}
		const bytes = pcmBytes(frame.samples);
		if (this.audioWriter) {
			await this.audioWriter.write(encodeAudioPacket(bytes));
			return;
		}
		const next = this.audioTail.then(async () => {
			const response = await fetch(`/api/realtime/sessions/${encodeURIComponent(id)}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'audio/pcm',
					'X-Audio-Sample-Rate': '24000'
				},
				body: bytes.buffer as ArrayBuffer
			});
			if (!response.ok) throw new Error(await responseError(response, 'Could not send audio'));
		});
		this.audioTail = next.catch(() => undefined);
		await next;
	}

	async sendText(text: string): Promise<void> {
		await this.post('text', { text });
	}

	setImage(image: { kind: 'blob'; blob: Blob; mimeType: string } | undefined): void {
		if (!image || this.closed || !this.sessionId) return;
		this.pendingImage = { blob: image.blob, mimeType: image.mimeType };
		if (!this.imageTask) {
			this.imageTask = this.flushImages().finally(() => {
				this.imageTask = undefined;
			});
			void this.imageTask.catch((error) => this.fail(error));
		}
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
			await fetch(`/api/realtime/sessions/${encodeURIComponent(id)}`, {
				method: 'DELETE'
			}).catch(() => undefined);
		}
		this.eventsController.abort();
		await this.eventsCompletion.catch(() => undefined);
		await this.imageTask?.catch(() => undefined);
		this.listeners.clear();
	}

	private async consumeEvents(): Promise<void> {
		const id = this.requireSession();
		const response = await fetch(`/api/realtime/sessions/${encodeURIComponent(id)}`, {
			headers: { Accept: 'application/x-aiwrapper-realtime-events' },
			signal: this.eventsController.signal
		});
		if (!response.ok || !response.body) {
			throw new Error(await responseError(response, 'Could not open realtime event stream'));
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
			if (!this.closed) throw new Error('Realtime event stream disconnected');
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	}

	private async openAudioUpload(): Promise<void> {
		const id = this.requireSession();
		const stream = new TransformStream<Uint8Array, Uint8Array>();
		this.audioWriter = stream.writable.getWriter();
		const response = await fetch(`/api/realtime/sessions/${encodeURIComponent(id)}`, {
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

	private async flushImages(): Promise<void> {
		while (this.pendingImage && !this.closed) {
			const image = this.pendingImage;
			this.pendingImage = undefined;
			const id = this.requireSession();
			const response = await fetch(`/api/realtime/sessions/${encodeURIComponent(id)}/image`, {
				method: 'POST',
				headers: { 'Content-Type': image.mimeType },
				body: image.blob
			});
			if (!response.ok)
				throw new Error(await responseError(response, 'Could not send camera image'));
		}
	}

	private async post(path: string, body?: unknown): Promise<void> {
		const id = this.requireSession();
		if (this.closed) throw new Error('Realtime session is closed');
		const response = await fetch(
			`/api/realtime/sessions/${encodeURIComponent(id)}/${encodeURIComponent(path)}`,
			{
				method: 'POST',
				...(body === undefined
					? {}
					: { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
			}
		);
		if (!response.ok) throw new Error(await responseError(response, `Could not ${path}`));
	}

	private requireSession(): string {
		if (!this.sessionId) throw new Error('Realtime session is not connected');
		return this.sessionId;
	}

	private emit(event: RemoteRealtimeEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	private fail(value: unknown): void {
		if (this.closed || isAbortError(value)) return;
		const error = value instanceof Error ? value : new Error(String(value));
		this.rejectConnected?.(error);
		this.emit({ type: 'error', error });
	}
}

function pcmBytes(samples: Int16Array): Uint8Array {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < samples.length; index++) {
		view.setInt16(index * 2, samples[index], true);
	}
	return bytes;
}

function serverError(error: RealtimeServerError): Error {
	const details = [
		error.status ? `HTTP ${error.status}` : '',
		error.code || '',
		error.requestId ? `request ${error.requestId}` : ''
	].filter(Boolean);
	return new Error(
		`${error.provider ? `${error.provider}: ` : ''}${details.length ? `(${details.join(', ')}) ` : ''}${error.message}`
	);
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
