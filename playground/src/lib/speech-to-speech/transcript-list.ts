export type SpeechToSpeechTranscriptEntry = {
	id: number;
	providerId?: string;
	speaker: 'user' | 'assistant';
	text: string;
	final: boolean;
};

export type SpeechToSpeechTranscriptUpdate = {
	id?: string;
	speaker: 'user' | 'assistant';
	text: string;
	final: boolean;
};

export function updateSpeechToSpeechTranscripts(
	entries: SpeechToSpeechTranscriptEntry[],
	event: SpeechToSpeechTranscriptUpdate,
	localId: number
): SpeechToSpeechTranscriptEntry[] {
	if (event.id) {
		const index = entries.findIndex(
			(entry) => entry.providerId === event.id && entry.speaker === event.speaker
		);
		if (index !== -1) {
			const updated = [...entries];
			updated[index] = { ...updated[index], text: event.text, final: event.final };
			return updated;
		}
	}

	const last = entries.at(-1);
	if (!event.final) {
		if (last && !last.final && last.speaker === event.speaker) {
			return [...entries.slice(0, -1), { ...last, text: last.text + event.text }];
		}
		return [...entries, createEntry(event, localId)];
	}
	if (last && !last.final && last.speaker === event.speaker) {
		return [
			...entries.slice(0, -1),
			{ ...last, providerId: event.id, text: event.text, final: true }
		];
	}
	return [...entries, createEntry(event, localId)];
}

function createEntry(
	event: SpeechToSpeechTranscriptUpdate,
	localId: number
): SpeechToSpeechTranscriptEntry {
	return {
		id: localId,
		providerId: event.id,
		speaker: event.speaker,
		text: event.text,
		final: event.final
	};
}
