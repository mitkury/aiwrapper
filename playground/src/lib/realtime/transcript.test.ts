import { expect, it } from 'vitest';
import { updateTranscript } from './transcript';

const first = { input: false, text: 'Good', text_output: false, final_result: false };

it('appends OpenAI deltas and replaces them with the final transcript', () => {
	const event = { ...first, id: 'item' };
	let rows = updateTranscript([], event, 'openai');
	rows = updateTranscript(rows, { ...event, text: ' morning' }, 'openai');
	expect(rows.map((r) => r.text)).toEqual(['Good morning']);
	rows = updateTranscript(rows, { ...event, final_result: true, text: 'Good morning!' }, 'openai');
	expect(rows.map((r) => r.text)).toEqual(['Good morning!']);
});

it('keeps interleaved Gemini speakers separate and closes an anonymous utterance', () => {
	let rows = updateTranscript([], first, 'gemini');
	rows = updateTranscript(rows, { ...first, input: true, text: 'Hello' }, 'gemini');
	rows = updateTranscript(rows, { ...first, final_result: true, text: ' morning!' }, 'gemini');
	rows = updateTranscript(rows, { ...first, text: 'Next' }, 'gemini');
	expect(rows.map((r) => r.text)).toEqual(['Good morning!', 'Hello', 'Next']);
});

it('replaces Cascade snapshots and gives each typed message its own row', () => {
	const snapshot = { ...first, id: '1', text_output: true };
	let rows = updateTranscript([], snapshot, 'cascade');
	rows = updateTranscript(
		rows,
		{ ...snapshot, final_result: true, text: 'Good morning!' },
		'cascade'
	);
	expect(rows.map((r) => r.text)).toEqual(['Good morning!']);
	const typed = { ...first, input: true, text_output: true, final_result: true };
	for (let i = 0; i < 105; i++) rows = updateTranscript(rows, typed, 'cascade');
	expect(rows).toHaveLength(100);
	expect(new Set(rows.map((r) => r.id)).size).toBe(100);
});
