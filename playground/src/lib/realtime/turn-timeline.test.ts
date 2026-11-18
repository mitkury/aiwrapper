import { describe, it, expect, vi } from 'vitest';
import { TurnTimeline, finished } from './turn-timeline';
describe('bounded turn timeline', () => {
	it('finishes a sound-only turn without labeling it interrupted on later input or shutdown', () => {
		const t = new TurnTimeline(() => {});
		t.begin('speech', 100, 'sound');
		t.input('sound', '', true, 500);
		t.stop(600);
		t.begin('typed', 601, undefined, 'next');
		t.input(undefined, 'next', true, 610);
		t.request('reply', 620, 0);
		t.stop(1000, true, 'error');
		expect(t.turns[0].ready).toBe(500);
		expect(t.turns[0].stopped).toBeUndefined();
		expect(t.turns[1].stopReason).toBe('error');
	});
	it('groups streaming input and tool rounds, without updates for each audio packet', () => {
		const change = vi.fn();
		const t = new TurnTimeline(change);
		t.begin('speech', 100, 'voice');
		t.input('voice', 'hello', false, 200);
		t.input('voice', 'hello there', true, 900);
		t.request('r1', 920, 4);
		t.mark('r1', 'text', 1300);
		t.mark('r1', 'text', 1500);
		t.mark('r1', 'tts', 1600);
		t.mark('r1', 'audio', 1900);
		const count = change.mock.calls.length;
		for (let i = 0; i < 1000; i++) t.mark('r1', 'audio', 2000 + i);
		expect(change).toHaveBeenCalledTimes(count);
		t.playback('r1', 'start', 1950);
		t.playback('r1', 'end', 2200);
		expect(finished(t.turns[0].rounds[0])).toBe(false);
		t.mark('r1', 'audio', 2300);
		expect(t.turns[0].rounds[0].end).toBeUndefined();
		t.mark('r1', 'synthesisEnd', 2400);
		t.playback('r1', 'end', 3200);
		expect(finished(t.turns[0].rounds[0])).toBe(true);
		t.request('r2', 3300, 4);
		expect(t.turns).toHaveLength(1);
		expect(t.turns[0].rounds).toHaveLength(2);
		expect(t.turns[0].rounds[0].text).toBe(1300);
		expect(t.turns[0].ready).toBe(900);
	});
	it('keeps late old playback separate from a new input, even when commit interrupts the old reply', () => {
		const t = new TurnTimeline(() => {});
		t.begin('typed', 0, undefined, 'first');
		t.input(undefined, 'first', true, 5);
		t.request('old', 10, 0);
		t.begin('speech', 100, 'second');
		t.input('second', 'new input', true, 300);
		t.playback('old', 'start', 200);
		t.stop(310, false);
		t.request('new', 320, 0);
		t.mark('old', 'audio', 330);
		expect(t.turns[0].rounds[0].stopped).toBe(310);
		expect(t.turns[1].stopped).toBeUndefined();
		expect(t.turns[1].rounds[0].play).toBeUndefined();
	});
	it('bounds metadata and ignores events for evicted replies', () => {
		const t = new TurnTimeline(() => {});
		for (let i = 0; i < 120; i++) {
			t.begin('typed', i, undefined, 'a'.repeat(5000));
			t.input(undefined, 'a'.repeat(5000), true, i);
			t.request(String(i), i, 12);
		}
		expect(t.turns).toHaveLength(80);
		expect(t.turns[0].id).toBe(41);
		expect(t.turns.every((r) => r.label.length === 200)).toBe(true);
		t.playback('0', 'start', 1000);
		expect(t.turns.every((r) => r.rounds[0].play === undefined)).toBe(true);
		t.stop(1001);
		expect(t.turns.every((r) => r.stopped === 1001)).toBe(true);
	});
});
