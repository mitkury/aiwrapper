import type { PcmAudioFrame } from 'aiwrapper';
import {
	RemoteAudioSession,
	type RemoteAudioSessionEvent
} from '$lib/realtime/remote-audio-session';

export type SpeechToSpeechProviderId = 'openai' | 'gemini' | 'xai' | 'azure' | 'nova';

export type SpeechToSpeechSessionConfig = {
	provider: SpeechToSpeechProviderId;
	model: string;
	voice: string;
	instructions?: string;
};

export type RemoteSpeechToSpeechEvent = RemoteAudioSessionEvent;

export class RemoteSpeechToSpeechSession {
	private readonly transport: RemoteAudioSession<SpeechToSpeechSessionConfig>;

	constructor(config: SpeechToSpeechSessionConfig) {
		this.transport = new RemoteAudioSession({
			basePath: '/api/speech-to-speech/sessions',
			config,
			sessionName: 'Speech-to-speech',
			defaultInputSampleRate: 24000
		});
	}

	get inputSampleRate(): number {
		return this.transport.inputSampleRate;
	}

	subscribe(listener: (event: RemoteSpeechToSpeechEvent) => void): () => void {
		return this.transport.subscribe(listener);
	}

	async connect(): Promise<void> {
		await this.transport.connect();
	}

	async sendAudio(frame: PcmAudioFrame): Promise<void> {
		await this.transport.sendAudio(frame);
	}

	async close(): Promise<void> {
		await this.transport.close();
	}
}
