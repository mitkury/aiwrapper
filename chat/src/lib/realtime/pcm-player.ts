import type { PcmAudioFrame } from 'aiwrapper/unstable/speech';

export class PcmStreamPlayer {
	private context?: AudioContext;
	private nextStartTime = 0;
	private readonly sources = new Set<AudioBufferSourceNode>();

	async resume(): Promise<void> {
		this.context ??= new AudioContext();
		if (this.context.state === 'suspended') await this.context.resume();
	}

	enqueue(frame: PcmAudioFrame): void {
		const context = this.context;
		if (!context || frame.samples.length === 0) return;
		const buffer = context.createBuffer(1, frame.samples.length, frame.sampleRate);
		const channel = buffer.getChannelData(0);
		for (let index = 0; index < frame.samples.length; index++) {
			channel[index] = frame.samples[index] / 32768;
		}
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		this.sources.add(source);
		source.onended = () => {
			this.sources.delete(source);
			source.disconnect();
		};
		const startAt = Math.max(this.nextStartTime, context.currentTime + 0.025);
		source.start(startAt);
		this.nextStartTime = startAt + buffer.duration;
	}

	clear(): void {
		for (const source of this.sources) {
			try {
				source.stop();
			} catch {
				// A scheduled source may already have ended.
			}
			source.disconnect();
		}
		this.sources.clear();
		this.nextStartTime = this.context?.currentTime ?? 0;
	}

	async close(): Promise<void> {
		this.clear();
		if (this.context && this.context.state !== 'closed') await this.context.close();
		this.context = undefined;
	}
}
