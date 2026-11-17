/** Browser-owned playback cursors; queued audio is never reported as played. */
export type Cursor = { type: 'played'; item: string; index: number; ms: number };
type Chunk = {
	source: AudioBufferSourceNode;
	start: number;
	samples: number;
	rate: number;
	offset: number;
	item: string;
	index: number;
	observed: boolean;
};
export type PlaybackMoment = { item: string; kind: 'start' | 'end' | 'stop'; at: number };
export class PlaybackQueueFull extends Error {
	constructor() {
		super(
			'Reply stopped because buffered speech reached its limit. The session is still connected.'
		);
	}
}
export class CascadePlayer {
	private context = new AudioContext();
	private next = 0;
	private chunks = new Set<Chunk>();
	private totals = new Map<string, number>();
	private bufferedBytes = 0;
	constructor(
		private report: (cursor: Cursor) => void,
		private moment: (event: PlaybackMoment) => void = () => {}
	) {}
	/** Observe the render clock, not the time an audio packet was received. */
	poll() {
		if (this.context.state !== 'running') return;
		for (const chunk of this.chunks) {
			if (!chunk.observed && this.context.currentTime >= chunk.start) {
				chunk.observed = true;
				this.moment({ item: chunk.item, kind: 'start', at: this.wallTime(chunk.start) });
			}
		}
	}
	private wallTime(audioTime: number) {
		return performance.now() - Math.max(0, this.context.currentTime - audioTime) * 1000;
	}
	get bufferedSeconds() {
		return Math.max(0, this.next - this.context.currentTime);
	}
	async resume() {
		await this.context.resume();
	}
	enqueue(item: string, index: number, samples: number[], rate: number) {
		if (!samples.length) return;
		// Synthesis routinely runs faster than playback. Bound a burst of speech,
		// rather than treating an ordinary answer longer than ten seconds as fatal.
		const start = Math.max(this.next, this.context.currentTime + 0.015);
		const bytes = samples.length * Float32Array.BYTES_PER_ELEMENT;
		if (
			start + samples.length / rate - this.context.currentTime > 120 ||
			this.bufferedBytes + bytes > 16 * 1024 * 1024 ||
			this.chunks.size >= 4096
		)
			throw new PlaybackQueueFull();
		const key = `${item}:${index}`;
		const offset = this.totals.get(key) || 0;
		this.totals.set(key, offset + samples.length);
		const buffer = this.context.createBuffer(1, samples.length, rate);
		buffer.copyToChannel(
			Float32Array.from(samples, (s) => s / 32768),
			0
		);
		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.connect(this.context.destination);
		const chunk = {
			source,
			start,
			samples: samples.length,
			rate,
			offset,
			item,
			index,
			observed: false
		};
		this.chunks.add(chunk);
		this.bufferedBytes += bytes;
		source.onended = () => {
			this.poll();
			if (!this.chunks.delete(chunk)) return;
			this.bufferedBytes -= bytes;
			source.disconnect();
			if (![...this.chunks].some((c) => c.item === item))
				this.moment({ item, kind: 'end', at: this.wallTime(start + buffer.duration) });
			this.report({
				type: 'played',
				item,
				index,
				ms: Math.floor(((offset + samples.length) * 1000) / rate)
			});
		};
		source.start(start);
		this.next = start + buffer.duration;
	}
	clear() {
		this.poll();
		const items = new Set([...this.chunks].map((c) => c.item));
		const cursors = new Map<string, Cursor>();
		for (const c of this.chunks) {
			const played = Math.min(
				c.samples,
				Math.max(0, Math.floor((this.context.currentTime - c.start) * c.rate))
			);
			const key = `${c.item}:${c.index}`;
			// Future chunks must not count their offset as played.
			if (this.context.currentTime >= c.start)
				cursors.set(key, {
					type: 'played',
					item: c.item,
					index: c.index,
					ms: Math.floor(((c.offset + played) * 1000) / c.rate)
				});
			c.source.onended = null;
			c.source.stop();
			c.source.disconnect();
		}
		this.chunks.clear();
		this.bufferedBytes = 0;
		this.next = this.context.currentTime;
		for (const cursor of cursors.values()) this.report(cursor);
		for (const item of items) this.moment({ item, kind: 'stop', at: performance.now() });
	}
	async close() {
		this.clear();
		await this.context.close();
		this.totals.clear();
	}
}
