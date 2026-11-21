export type PlaybackCut = {
	itemId: string;
	playedMs: number;
	generatedMs: number;
	retainedText: string;
	unplayedText: string;
	accuracy: 'provider-timed' | 'estimated' | 'segment-boundary';
	playbackConfirmed: boolean;
};

export type TranscriptRow = {
	id: string;
	input: boolean;
	text: string;
	textOutput: boolean;
	finished: boolean;
	turnId?: number;
	cut?: PlaybackCut;
};

type Update = {
	id?: string | null;
	text: string;
	input: boolean;
	final_result: boolean;
	text_output: boolean;
};

export function updateTranscript(
	rows: TranscriptRow[],
	event: Update,
	mode: 'cascade' | 'openai' | 'gemini',
	turnId?: number
): TranscriptRow[] {
	const prefix = event.input ? 'in' : 'out';
	const key = event.id == null ? undefined : `${prefix}:${event.id}`;
	// Gemini streams fragments without item IDs. Its finished packet can
	// contain the final fragment or just mark the end of the transcript.
	let index = -1;
	if (key !== undefined) {
		index = rows.findIndex((row) => row.id === key && row.textOutput === event.text_output);
	} else if (mode === 'gemini') {
		index = rows.findLastIndex(
			(row) => !row.finished && row.input === event.input && row.textOutput === event.text_output
		);
	}
	const previous = rows[index];
	if (!event.text && (!previous || !event.final_result)) return rows;
	const append = mode === 'gemini' || (mode === 'openai' && !event.final_result);
	const text = append ? (previous?.text ?? '') + event.text : event.text;
	const row = {
		...previous,
		id: key ?? previous?.id ?? `local:${crypto.randomUUID()}`,
		input: event.input,
		text,
		textOutput: event.text_output,
		finished: event.final_result,
		turnId
	};
	if (!previous) return [...rows.slice(-99), row];
	const updated = rows.slice();
	updated[index] = row;
	return updated;
}
