/** Small timing records only. Image payloads remain in the separately bounded frame store. */
export type RoundTiming = {
	id: string;
	request: number;
	text?: number;
	tts?: number;
	audio?: number;
	play?: number;
	end?: number;
	modelEnd?: number;
	synthesisEnd?: number;
	stopped?: number;
	frames: number;
};
export type TurnTiming = {
	id: number;
	inputId?: string;
	kind: 'speech' | 'typed';
	label: string;
	start: number;
	ready?: number;
	stopped?: number;
	rounds: RoundTiming[];
};
export const finished = (r: RoundTiming) =>
	r.stopped !== undefined ||
	(r.synthesisEnd !== undefined &&
		(r.end !== undefined || (r.audio === undefined && r.modelEnd !== undefined)));
export const duration = (ms: number) =>
	ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

export class TurnTimeline {
	turns: TurnTiming[] = [];
	private sequence = 0;
	private currentRound?: string;
	constructor(private change: (turns: TurnTiming[]) => void) {}
	private publish(turn: TurnTiming) {
		// Copy only the changed turn. Never notify for every PCM packet or microphone sample.
		this.turns = this.turns.map((t) =>
			t.id === turn.id ? { ...t, rounds: t.rounds.map((r) => ({ ...r })) } : t
		);
		this.change(this.turns);
	}
	begin(kind: TurnTiming['kind'], at: number, inputId?: string, label = '') {
		if (inputId && this.turns.some((t) => t.inputId === inputId)) return;
		this.turns = [
			...this.turns.slice(-79),
			{ id: ++this.sequence, inputId, kind, label: label.slice(0, 200), start: at, rounds: [] }
		];
		this.change(this.turns);
	}
	input(id: string | undefined, text: string, final: boolean, at: number) {
		let turn = id ? this.turns.find((t) => t.inputId === id) : undefined;
		const latest = this.turns.at(-1);
		if (!turn && latest && latest.ready === undefined && latest.stopped === undefined)
			turn = latest;
		if (!turn) {
			this.begin(id ? 'speech' : 'typed', at, id, text);
			turn = this.turns.at(-1)!;
		}
		turn.inputId ??= id;
		turn.label = text.slice(0, 200);
		if (final) turn.ready ??= at;
		this.publish(turn);
	}
	request(id: string, at: number, frames: number) {
		const turn = this.turns.at(-1);
		if (!turn || turn.rounds.some((r) => r.id === id) || turn.rounds.length >= 12) return;
		turn.rounds.push({ id, request: at, frames });
		this.currentRound = id;
		this.publish(turn);
	}
	mark(
		id: string | undefined,
		key: 'text' | 'tts' | 'audio' | 'modelEnd' | 'synthesisEnd',
		at: number
	) {
		this.update(id ?? this.currentRound, (round) => {
			if (round.stopped !== undefined) return false;
			if (key === 'audio' && round.end !== undefined) {
				round.end = undefined;
				return true;
			}
			if (round[key] !== undefined) return false;
			round[key] = at;
			return true;
		});
	}
	playback(id: string, kind: 'start' | 'end' | 'stop', at: number) {
		this.update(id, (r) => {
			if (r.stopped !== undefined) return false;
			if (kind === 'start') {
				if (r.play !== undefined) return false;
				r.play = at;
			} else if (kind === 'end') r.end = at;
			else r.stopped = at;
			return true;
		});
	}
	stop(at: number, includePending = true) {
		for (const turn of this.turns) {
			if (!includePending && !turn.rounds.length) continue;
			if (turn.stopped !== undefined || (turn.rounds.length && turn.rounds.every(finished)))
				continue;
			turn.stopped = at;
			for (const round of turn.rounds) if (!finished(round)) round.stopped = at;
			this.publish(turn);
		}
	}
	private update(id: string | undefined, apply: (r: RoundTiming) => boolean) {
		const turn = this.turns.find((t) => t.rounds.some((r) => r.id === id));
		const round = turn?.rounds.find((r) => r.id === id);
		if (turn && round && apply(round)) this.publish(turn);
	}
}
