import type { PcmAudioFrame } from 'aiwrapper';
import { encodeAudioPacket } from './audio-upload-protocol';
import { pcmSamplesToBytes } from './pcm';
import {
	RealtimeEventDecoder,
	type RealtimeServerError,
	type RealtimeServerEvent
} from './realtime-session-protocol';

export type RemoteAudioSessionEvent =
	| Exclude<RealtimeServerEvent, { type: 'heartbeat' | 'error' }>
	| { type: 'audio'; frame: PcmAudioFrame }
	| { type: 'error'; error: Error };

type RemoteAudioSessionOptions<Config> = {
	basePath: string;
	config: Config;
	sessionName: string;
	defaultInputSampleRate?: number;
};

export class RemoteAudioSession<Config> {
	private readonly listeners = new Set<(event: RemoteAudioSessionEvent) => void>();
	private readonly eventsController = new AbortController();
	private readonly startController = new AbortController();
	private readonly connected: Promise<void>;
	private sessionId?: string;
	private audioWriter?: WritableStreamDefaultWriter<Uint8Array>;
	private audioTail = Promise.resolve();
	private uploadCompletion = Promise.resolve();
	private eventsCompletion = Promise.resolve();
	private state: 'idle' | 'connecting' | 'connected' | 'closed' = 'idle';
	private transportFailureReported = false;
	private resolveConnected?: () => void;
	private rejectConnected?: (error: Error) => void;
	inputSampleRate: number;

	constructor(private readonly options: RemoteAudioSessionOptions<Config>) {
		this.inputSampleRate = options.defaultInputSampleRate ?? 24000;
		this.connected = new Promise<void>((resolve, reject) => {
			this.resolveConnected = resolve;
			this.rejectConnected = reject;
		});
	}

	get isConnected(): boolean {
		return this.state === 'connected';
	}

	subscribe(listener: (event: RemoteAudioSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async connect(): Promise<void> {
		if (this.state === 'closed') {
			throw new Error(`${this.options.sessionName} session is closed`);
		}
		if (this.state !== 'idle') {
			throw new Error(
				`${this.options.sessionName} session is already ${this.state === 'connecting' ? 'connecting' : 'connected'}`
			);
		}
		this.state = 'connecting';
		let response: Response;
		let body: {
			id?: string;
			inputSampleRate?: number;
			error?: string;
		};
		try {
			response = await fetch(this.options.basePath, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(this.options.config),
				signal: this.startController.signal
			});
			body = (await response.json()) as typeof body;
		} catch (error) {
			if (this.isClosed()) {
				throw new Error(`${this.options.sessionName} session is closed`);
			}
			this.state = 'idle';
			throw error;
		}
		if (!response.ok || !body.id) {
			this.state = 'idle';
			throw new Error(
				body.error || `Could not start ${this.options.sessionName.toLowerCase()} session`
			);
		}
		if (this.isClosed()) {
			await this.deleteSession(body.id);
			throw new Error(`${this.options.sessionName} session is closed`);
		}
		if (body.inputSampleRate !== undefined) {
			try {
				assertSampleRate(body.inputSampleRate);
			} catch (error) {
				this.state = 'idle';
				await this.deleteSession(body.id);
				throw error;
			}
			this.inputSampleRate = body.inputSampleRate;
		}
		this.sessionId = body.id;
		this.eventsCompletion = this.consumeEvents();
		void this.eventsCompletion.catch((error) => this.fail(error));
		if (canStreamToCurrentOrigin()) {
			this.uploadCompletion = this.openAudioUpload();
			void this.uploadCompletion.catch((error) => this.fail(error));
		}
		try {
			await this.connected;
		} catch (error) {
			await this.close();
			throw error;
		}
	}

	async sendAudio(frame: PcmAudioFrame): Promise<void> {
		this.assertNotClosed();
		const id = this.requireSession();
		if (
			frame.encoding !== 'pcm_s16le' ||
			frame.channels !== 1 ||
			frame.sampleRate !== this.inputSampleRate
		) {
			throw new Error(
				`${this.options.sessionName} input requires mono ${this.inputSampleRate} Hz signed 16-bit PCM`
			);
		}
		const bytes = pcmSamplesToBytes(frame.samples);
		if (this.audioWriter) {
			await this.audioWriter.write(encodeAudioPacket(bytes));
			return;
		}
		const next = this.audioTail.then(async () => {
			const response = await fetch(this.sessionURL(id), {
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

	async post(path: string, body?: unknown): Promise<void> {
		this.assertNotClosed();
		const id = this.requireSession();
		const response = await fetch(`${this.sessionURL(id)}/${encodeURIComponent(path)}`, {
			method: 'POST',
			...(body === undefined
				? {}
				: { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
		});
		if (!response.ok) throw new Error(await responseError(response, `Could not ${path}`));
	}

	async postBlob(path: string, blob: Blob, mimeType: string, fallback: string): Promise<void> {
		this.assertNotClosed();
		const id = this.requireSession();
		const response = await fetch(`${this.sessionURL(id)}/${encodeURIComponent(path)}`, {
			method: 'POST',
			headers: { 'Content-Type': mimeType },
			body: blob
		});
		if (!response.ok) throw new Error(await responseError(response, fallback));
	}

	reportError(value: unknown): void {
		if (this.state === 'closed' || isAbortError(value)) return;
		this.emit({
			type: 'error',
			error: value instanceof Error ? value : new Error(String(value))
		});
	}

	async close(): Promise<void> {
		if (this.state === 'closed') return;
		const wasConnecting = this.state === 'connecting';
		this.state = 'closed';
		this.startController.abort();
		if (wasConnecting && this.sessionId) {
			this.rejectConnection(new Error(`${this.options.sessionName} session is closed`));
		}
		const id = this.sessionId;
		this.sessionId = undefined;
		await this.audioTail;
		await this.audioWriter?.close().catch(() => undefined);
		await this.uploadCompletion.catch(() => undefined);
		if (id) {
			await this.deleteSession(id);
		}
		this.eventsController.abort();
		await this.eventsCompletion.catch(() => undefined);
		this.listeners.clear();
	}

	private async consumeEvents(): Promise<void> {
		const id = this.requireSession();
		const response = await fetch(this.sessionURL(id), {
			headers: { Accept: 'application/x-aiwrapper-realtime-events' },
			signal: this.eventsController.signal
		});
		if (!response.ok || !response.body) {
			throw new Error(
				await responseError(
					response,
					`Could not open ${this.options.sessionName.toLowerCase()} event stream`
				)
			);
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
			if (this.state !== 'closed') {
				throw new Error(`${this.options.sessionName} event stream disconnected`);
			}
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	}

	private async openAudioUpload(): Promise<void> {
		const id = this.requireSession();
		const stream = new TransformStream<Uint8Array, Uint8Array>();
		this.audioWriter = stream.writable.getWriter();
		const response = await fetch(this.sessionURL(id), {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-aiwrapper-audio-stream' },
			body: stream.readable,
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });
		if (!response.ok) throw new Error(await responseError(response, 'Audio stream failed'));
	}

	private handleServerEvent(event: RealtimeServerEvent): void {
		if (this.state === 'closed' || event.type === 'heartbeat') return;
		if (event.type === 'connected') {
			this.state = 'connected';
			this.resolveConnected?.();
			this.clearConnectionCallbacks();
		}
		if (event.type === 'error') {
			const error = serverError(event.error);
			if (this.state === 'connecting') this.rejectConnection(error);
			this.emit({ type: 'error', error });
			return;
		}
		this.emit(event);
	}

	private requireSession(): string {
		if (!this.sessionId) {
			throw new Error(`${this.options.sessionName} session is not connected`);
		}
		return this.sessionId;
	}

	private assertNotClosed(): void {
		if (this.state === 'closed') {
			throw new Error(`${this.options.sessionName} session is closed`);
		}
	}

	private isClosed(): boolean {
		return this.state === 'closed';
	}

	private sessionURL(id: string): string {
		return `${this.options.basePath}/${encodeURIComponent(id)}`;
	}

	private emit(event: RemoteAudioSessionEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	private rejectConnection(error: Error): void {
		this.rejectConnected?.(error);
		this.clearConnectionCallbacks();
	}

	private clearConnectionCallbacks(): void {
		this.resolveConnected = undefined;
		this.rejectConnected = undefined;
	}

	private async deleteSession(id: string): Promise<void> {
		await fetch(this.sessionURL(id), { method: 'DELETE' }).catch(() => undefined);
	}

	private fail(value: unknown): void {
		if (this.state === 'closed' || isAbortError(value) || this.transportFailureReported) return;
		this.transportFailureReported = true;
		const error = value instanceof Error ? value : new Error(String(value));
		if (this.state === 'connecting') this.rejectConnection(error);
		this.emit({ type: 'error', error });
	}
}

function assertSampleRate(value: number): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error('Server returned an invalid audio input sample rate');
	}
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
