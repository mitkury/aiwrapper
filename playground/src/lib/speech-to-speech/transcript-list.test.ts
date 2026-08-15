import { describe, expect, it } from 'vitest';
import { updateSpeechToSpeechTranscripts } from './transcript-list';

describe('speech-to-speech transcript list', () => {
	it('replaces repeated final transcripts with the same provider item ID', () => {
		let entries = updateSpeechToSpeechTranscripts(
			[],
			{ id: 'item-1', speaker: 'user', text: 'Do you have', final: true },
			1
		);
		entries = updateSpeechToSpeechTranscripts(
			entries,
			{ id: 'item-1', speaker: 'user', text: 'Do you have a way to see things?', final: true },
			2
		);

		expect(entries).toEqual([
			{
				id: 1,
				providerId: 'item-1',
				speaker: 'user',
				text: 'Do you have a way to see things?',
				final: true
			}
		]);
	});

	it('folds transcript deltas into the final provider item', () => {
		let entries = updateSpeechToSpeechTranscripts(
			[],
			{ speaker: 'assistant', text: 'Hi', final: false },
			1
		);
		entries = updateSpeechToSpeechTranscripts(
			entries,
			{ speaker: 'assistant', text: ' there', final: false },
			2
		);
		entries = updateSpeechToSpeechTranscripts(
			entries,
			{ id: 'item-2', speaker: 'assistant', text: 'Hi there', final: true },
			3
		);

		expect(entries).toMatchObject([
			{ providerId: 'item-2', text: 'Hi there', final: true }
		]);
	});
});
