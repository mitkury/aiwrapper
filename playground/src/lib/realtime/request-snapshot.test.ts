import { describe, expect, it } from 'vitest';
import {
	attachProviderRequest,
	cameraRequest,
	readableRequest,
	retainRequest,
	type RequestPayload
} from './request-snapshot';
function payload(itemId = 'one'): RequestPayload {
	return {
		kind: 'request',
		itemId,
		conversation: {
			instructions: 'Speak plainly.',
			messages: [
				{
					role: 'user',
					items: [
						{ type: 'image', base64: 'caller-image', mimeType: 'image/png' },
						{ type: 'text', text: 'What changed?' },
						{ type: 'text', text: 'Recent views' },
						{ type: 'image', base64: 'selected-frame', mimeType: 'image/jpeg' }
					]
				}
			]
		},
		camera: {
			candidateCount: 2,
			omittedCount: 1,
			evictedSincePreviousTurn: 0,
			reusedLatest: false,
			policy: 'recent',
			itemStart: 2,
			frames: [{ id: 7, capturedAtMs: 1250, clock: 'capture' }]
		},
		tools: [{ name: 'add' }],
		maxTokens: 1024
	};
}
describe('request snapshots', () => {
	it('links selected frames without dropping other images, instructions or tool input', () => {
		const p = payload();
		const r = retainRequest([], p, 2500).requests[0];
		expect(r.payload).toBe(p);
		expect(r.time).toBe('2.50');
		expect(cameraRequest(r)?.frames).toEqual([
			{ id: 7, capturedAtMs: 1250, clock: 'capture', data: 'selected-frame', mime: 'image/jpeg' }
		]);
		expect(r.payload.conversation.messages[0].items[0].base64).toBe('caller-image');
		expect(r.payload.tools).toEqual([{ name: 'add' }]);
	});
	it('retains no-camera requests and separate tool continuation snapshots', () => {
		const first = payload('first');
		first.camera = null;
		const second = structuredClone(first);
		second.itemId = 'continuation';
		second.conversation.messages.push({
			role: 'tool-results',
			items: [{ type: 'tool-result', name: 'add', result: 5 }]
		});
		const list = retainRequest(retainRequest([], first, 0).requests, second, 100).requests;
		expect(list).toHaveLength(2);
		expect(cameraRequest(list[0])).toBeUndefined();
		expect(list[0].payload.conversation.messages).toHaveLength(1);
		expect(list[1].payload.conversation.messages).toHaveLength(2);
	});
	it('caps both request count and total size including text-only payloads', () => {
		let list = retainRequest([], payload('0'), 0).requests;
		for (let i = 1; i < 10; i++) list = retainRequest(list, payload(String(i)), i).requests;
		expect(list).toHaveLength(8);
		expect(list[0].itemId).toBe('2');
		const huge = payload('huge');
		huge.conversation.instructions = 'x'.repeat(8 * 1024 * 1024);
		const result = retainRequest(list, huge, 20);
		expect(result.requests).toHaveLength(0);
		expect(result.dropped).toBe(9);
	});
	it('omits nested image bytes only in the readable structure, preserving the snapshot', () => {
		const p = payload();
		p.conversation.messages.push({
			role: 'tool-results',
			items: [
				{
					type: 'tool-result',
					result: {
						type: 'tool-content',
						content: [{ type: 'image', base64: 'tool-image', mimeType: 'image/png' }]
					}
				}
			]
		});
		const text = readableRequest(p);
		expect(text).not.toContain('selected-frame');
		expect(text).not.toContain('tool-image');
		expect(text).toContain('What changed?');
		expect(text).toContain('see image preview');
		expect(p.conversation.messages[0].items[3].base64).toBe('selected-frame');
	});
});

it('attaches provider JSON by request ID and counts it toward the shared retention budget', () => {
	const requests = retainRequest(
		retainRequest([], payload('old'), 0).requests,
		payload('new'),
		1
	).requests;
	const wire = {
		provider: 'anthropic',
		model: 'model',
		path: '/messages',
		attempt: 0,
		body: {
			messages: [
				{
					content: [
						{ type: 'text', text: 'Camera frame 7 at 12.345s' },
						{
							type: 'image',
							source: { type: 'base64', media_type: 'image/jpeg', data: 'image-bytes' }
						}
					]
				}
			]
		}
	};
	const result = attachProviderRequest(requests, 'old', wire);
	expect(result.requests[0].wire).toBe(wire);
	expect(result.requests[1].wire).toBeUndefined();
	expect(result.requests[0].size).toBeGreaterThan(requests[0].size);
	expect(readableRequest(wire)).toContain('12.345s');
	expect(readableRequest(wire)).not.toContain('image-bytes');
	expect(attachProviderRequest(requests, 'evicted', wire).requests.every((r) => !r.wire)).toBe(
		true
	);
	const huge = { ...wire, body: { text: 'x'.repeat(8 * 1024 * 1024) } };
	expect(attachProviderRequest(requests, 'old', huge).requests.map((r) => r.itemId)).toEqual([
		'new'
	]);
});
it('shortens all supported provider image encodings without changing their text or structure', () => {
	const body = {
		contents: [
			{
				parts: [
					{ text: 'frame at 1.234s' },
					{ inlineData: { mimeType: 'image/jpeg', data: 'google-bytes' } }
				]
			}
		],
		input: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,openai-bytes' }]
	};
	const shown = JSON.parse(readableRequest(body));
	expect(shown.contents[0].parts[0]).toEqual({ text: 'frame at 1.234s' });
	expect(shown.contents[0].parts[1].inlineData.data).toContain('see image preview');
	expect(shown.input[0].image_url).toContain('data:image/jpeg;base64,[');
	expect(body.contents[0].parts[1].inlineData?.data).toBe('google-bytes');
});
