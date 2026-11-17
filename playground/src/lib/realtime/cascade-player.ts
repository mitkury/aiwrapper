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
};
export class CascadePlayer {
	private context = new AudioContext();
	private next = 0;
	private chunks = new Set<Chunk>();
	private totals = new Map<string, number>();
	constructor(private report: (cursor: Cursor) => void) {}
	async resume() {
		await this.context.resume();
	}
	enqueue(item: string, index: number, samples: number[], rate: number) {
		if (this.next - this.context.currentTime > 10)
			throw new Error('Playback queue exceeded 10 seconds');
		if (!samples.length) return;
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
		const start = Math.max(this.next, this.context.currentTime + 0.015);
		const chunk = { source, start, samples: samples.length, rate, offset, item, index };
		this.chunks.add(chunk);
		source.onended = () => {
			if (!this.chunks.delete(chunk)) return;
			source.disconnect();
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
		this.next = this.context.currentTime;
		for (const cursor of cursors.values()) this.report(cursor);
	}
	async close() {
		this.clear();
		await this.context.close();
		this.totals.clear();
	}
}
