import { describe, expect, it } from 'vitest';
import { activityTimeline } from './activity-timeline';
import { TurnTimeline, type TurnTiming, type RoundTiming } from './turn-timeline';
const turn: TurnTiming = {
	id: 1,
	kind: 'speech',
	label: 'A question',
	start: 0,
	ready: 100,
	rounds: []
};
const round: RoundTiming = {
	id: 'r',
	request: 100,
	text: 400,
	tts: 600,
	audio: 800,
	play: 900,
	modelEnd: 1100,
	synthesisEnd: 1400,
	end: 5900,
	frames: 0
};
describe('parallel activity timeline', () => {
	it('shows a one-second AI response and five-second spoken reply on a shared axis', () => {
		const chart = activityTimeline(turn, round, 10000);
		const model = chart.lanes[2],
			synthesis = chart.lanes[3],
			playback = chart.lanes[4];
		expect(round.modelEnd! - round.request).toBe(1000);
		expect(playback.to! - playback.from!).toBe(5000);
		expect(synthesis.from).toBeLessThan(model.to!);
		expect(playback.from).toBeLessThan(synthesis.to!);
		expect(chart.span).toBe(6000);
		expect(chart.lanes.every((l) => !l.active)).toBe(true);
	});
	it('extends ongoing playback without extending completed generation', () => {
		const active = { ...round, end: undefined };
		const earlier = activityTimeline(turn, active, 2000),
			later = activityTimeline(turn, active, 4000);
		expect(earlier.lanes[4].to).toBe(2000);
		expect(later.lanes[4].to).toBe(4000);
		expect(later.lanes[4].active).toBe(true);
		expect(later.lanes[2].to).toBe(1100);
		expect(later.lanes[3].to).toBe(1400);
	});
	it('cuts only unfinished activities at interruption and freezes after the session', () => {
		const interrupted = {
			...round,
			synthesisEnd: undefined,
			end: undefined,
			stopped: 3000,
			stopReason: 'interrupted' as const
		};
		const chart = activityTimeline(turn, interrupted, 30000);
		expect(chart.stop).toBe(3000);
		expect(chart.lanes[2].cut).toBe(false);
		expect(chart.lanes[2].to).toBe(1100);
		expect(chart.lanes[3].to).toBe(3000);
		expect(chart.lanes[4].to).toBe(3000);
		expect(chart.lanes[4].cut).toBe(true);
		expect(chart.lanes.every((l) => !l.active)).toBe(true);
	});
	it('does not invent playback before first audio or extend already drained audio to a later stop', () => {
		const neverPlayed = { id: 'r', request: 100, frames: 0, stopped: 500 };
		expect(activityTimeline(turn, neverPlayed, 2000).lanes[4].from).toBeUndefined();
		expect(
			activityTimeline(turn, { ...round, synthesisEnd: undefined, end: 1700, stopped: 3000 }, 5000)
				.lanes[4].to
		).toBe(1700);
		expect(activityTimeline({ ...turn, stopped: 9000 }, round, 10000).stop).toBeUndefined();
	});
	it('distinguishes interrupted playback from session shutdown without relabeling older cuts', () => {
		const recorder = new TurnTimeline(() => {});
		recorder.begin('typed', 0);
		recorder.input(undefined, 'one', true, 10);
		recorder.request('one', 20, 0);
		recorder.playback('one', 'stop', 100);
		recorder.stop(101, false);
		recorder.begin('typed', 200);
		recorder.input(undefined, 'two', true, 210);
		recorder.request('two', 220, 0);
		recorder.playback('two', 'stop', 300);
		recorder.stop(301, true, 'session-ended');
		expect(recorder.turns[0].rounds[0].stopReason).toBe('interrupted');
		expect(recorder.turns[1].rounds[0].stopReason).toBe('session-ended');
	});
});
