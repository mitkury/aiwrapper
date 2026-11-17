import type { RoundTiming, TurnTiming } from './turn-timeline';

export type Activity = {
	label: string;
	color: string;
	from?: number;
	to?: number;
	active: boolean;
	cut: boolean;
	description: string;
};
/** One clock and one scale for all activities. Never add durations that overlap. */
export function activityTimeline(turn: TurnTiming, round: RoundTiming | undefined, now: number) {
	const stop = round ? round.stopped : turn.stopped;
	function lane(
		label: string,
		color: string,
		from: number | undefined,
		end: number | undefined,
		description: string
	): Activity {
		const to = from === undefined ? undefined : Math.max(from, end ?? stop ?? now);
		return {
			label,
			color,
			from,
			to,
			active: from !== undefined && end === undefined && stop === undefined,
			cut: from !== undefined && end === undefined && stop !== undefined,
			description
		};
	}
	const lanes = [
		lane(
			turn.kind === 'speech' ? 'User input' : 'Send input',
			'#718a9a',
			turn.start,
			turn.ready,
			'Speech detection through final transcript, including speaking and end-of-turn detection. Typed input ends when acknowledged.'
		),
		lane(
			'Wait for AI',
			'#aabdc8',
			round?.request,
			round?.text ?? round?.modelEnd,
			'Request observed through first model text. Includes transport and provider waiting.'
		),
		lane(
			'AI text generation',
			'#427b91',
			round?.text,
			round?.modelEnd,
			'First text through the final model response. Speech generation can begin before this finishes.'
		),
		lane(
			'Voice generation',
			'#8278ad',
			round?.tts,
			round?.synthesisEnd,
			'First speech request through completion of all speech generation, including waits between phrases.'
		),
		lane(
			'Voice playback',
			'#27866e',
			round?.play,
			round?.end,
			'First audio played through the last audio played or interruption. This is the full reply span, including any streaming gaps.'
		)
	];
	const end = Math.max(turn.start, ...lanes.map((l) => l.to ?? turn.start), stop ?? turn.start);
	return {
		lanes,
		origin: turn.start,
		span: Math.max(1000, Math.ceil((end - turn.start) / 500) * 500),
		stop,
		reason: round?.stopReason ?? turn.stopReason ?? 'interrupted'
	};
}
