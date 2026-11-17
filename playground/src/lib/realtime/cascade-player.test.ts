import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CascadePlayer, PlaybackQueueFull } from './cascade-player';

class TestAudioContext {
	currentTime = 0;
	state = 'running';
	destination = {};
	sources: { onended: (() => void) | null; start: ReturnType<typeof vi.fn> }[] = [];
	resume = vi.fn();
	close = vi.fn();
	createBuffer(_channels: number, samples: number, rate: number) {
		return { duration: samples / rate, copyToChannel: vi.fn() };
	}
	createBufferSource() {
		const source = {
			onended: null as (() => void) | null,
			connect: vi.fn(),
			disconnect: vi.fn(),
			start: vi.fn(),
			stop: vi.fn()
		};
		this.sources.push(source);
		return source;
	}
}

describe('cascade playback bursts', () => {
	let context: TestAudioContext;
	beforeEach(() => {
		context = new TestAudioContext();
		vi.stubGlobal(
			'AudioContext',
			class {
				constructor() {
					return context;
				}
			}
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('plays a thirty-second reply delivered faster than real time in order', () => {
		const report = vi.fn();
		const player = new CascadePlayer(report);
		for (let i = 0; i < 30; i++) player.enqueue('reply', 0, Array(24000).fill(0), 24000);
		expect(context.sources).toHaveLength(30);
		expect(context.sources[29].start).toHaveBeenCalledWith(29.015);
		expect(report).not.toHaveBeenCalled();
		context.currentTime = 30.015;
		for (const source of context.sources) source.onended?.();
		expect(report).toHaveBeenLastCalledWith({ type: 'played', item: 'reply', index: 0, ms: 30000 });
	});

	it('checks incoming duration before allocating and can play again after clearing', () => {
		const player = new CascadePlayer(vi.fn());
		expect(() => player.enqueue('huge', 0, Array(121 * 8000).fill(0), 8000)).toThrow(
			PlaybackQueueFull
		);
		expect(context.sources).toHaveLength(0);
		player.clear();
		expect(() => player.enqueue('next', 0, Array(24000).fill(0), 24000)).not.toThrow();
	});

	it('interrupts a buffered reply without acknowledging future audio', () => {
		const report = vi.fn();
		const player = new CascadePlayer(report);
		for (let i = 0; i < 30; i++) player.enqueue('reply', 0, Array(24000).fill(0), 24000);
		context.currentTime = 0.515;
		player.clear();
		expect(report).toHaveBeenCalledExactlyOnceWith({
			type: 'played',
			item: 'reply',
			index: 0,
			ms: 500
		});
		for (const source of context.sources) expect(source.onended).toBeNull();
	});
});

describe('playback timeline', () => {
	it('observes playback on the audio clock, excluding queued or cancelled audio', () => {
		const context = new TestAudioContext();
		vi.stubGlobal(
			'AudioContext',
			class {
				constructor() {
					return context;
				}
			}
		);
		const moments = vi.fn();
		const player = new CascadePlayer(vi.fn(), moments);
		player.enqueue('cancelled', 0, Array(24000).fill(0), 24000);
		player.poll();
		expect(moments).not.toHaveBeenCalled();
		player.clear();
		expect(moments.mock.calls.map(([m]) => m.kind)).toEqual(['stop']);
		moments.mockClear();
		player.enqueue('played', 0, Array(24000).fill(0), 24000);
		context.state = 'suspended';
		player.poll();
		expect(moments).not.toHaveBeenCalled();
		context.state = 'running';
		context.currentTime = 0.515;
		const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
		player.poll();
		player.poll();
		expect(moments).toHaveBeenCalledExactlyOnceWith({ item: 'played', kind: 'start', at: 500 });
		context.currentTime = 1.015;
		context.sources[1].onended?.();
		expect(moments).toHaveBeenLastCalledWith({ item: 'played', kind: 'end', at: 1000 });
		now.mockRestore();
		vi.unstubAllGlobals();
	});
});
