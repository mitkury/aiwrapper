import type { PcmAudioFrame } from 'aiwrapper/speech';
import { RemoteAudioSession, type RemoteAudioSessionEvent } from './remote-audio-session';
import type { RealtimeSessionConfig } from './realtime-session-protocol';

export type RemoteRealtimeEvent = RemoteAudioSessionEvent;

export class RemoteRealtimeSession {
	private readonly transport: RemoteAudioSession<RealtimeSessionConfig>;
	private pendingImage?: { blob: Blob; mimeType: string };
	private imageTask?: Promise<void>;
	private closed = false;

	constructor(config: RealtimeSessionConfig) {
		this.transport = new RemoteAudioSession({
			basePath: '/api/realtime/sessions',
			config,
			sessionName: 'Realtime',
			defaultInputSampleRate: 24000
		});
	}

	subscribe(listener: (event: RemoteRealtimeEvent) => void): () => void {
		return this.transport.subscribe(listener);
	}

	async connect(): Promise<void> {
		await this.transport.connect();
	}

	async sendAudio(frame: PcmAudioFrame): Promise<void> {
		await this.transport.sendAudio(frame);
	}

	async sendText(text: string): Promise<void> {
		await this.transport.post('text', { text });
	}

	setImage(image: { kind: 'blob'; blob: Blob; mimeType: string } | undefined): void {
		if (!image || this.closed || !this.transport.isConnected) return;
		this.pendingImage = { blob: image.blob, mimeType: image.mimeType };
		if (this.imageTask) return;
		this.imageTask = this.flushImages()
			.catch((error) => this.transport.reportError(error))
			.finally(() => {
				this.imageTask = undefined;
			});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.imageTask;
		await this.transport.close();
	}

	private async flushImages(): Promise<void> {
		while (this.pendingImage && !this.closed) {
			const image = this.pendingImage;
			this.pendingImage = undefined;
			await this.transport.postBlob(
				'image',
				image.blob,
				image.mimeType,
				'Could not send camera image'
			);
		}
	}
}
