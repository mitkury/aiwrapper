import { describe, expect, it } from 'vitest';
import {
	encodeRealtimeAudio,
	encodeRealtimeEvent,
	RealtimeEventDecoder
} from './realtime-session-protocol';

describe('realtime session event protocol', () => {
	it('decodes JSON events and binary PCM across arbitrary chunks', () => {
		const connected = encodeRealtimeEvent({ type: 'connected' });
		const audio = encodeRealtimeAudio({
			encoding: 'pcm_s16le',
			channels: 1,
			sampleRate: 24000,
			samples: new Int16Array([-32768, 0, 32767])
		});
		const bytes = concatenate(connected, audio);
		const decoder = new RealtimeEventDecoder();

		expect(decoder.push(bytes.slice(0, 4))).toEqual([]);
		expect(decoder.push(bytes.slice(4, connected.length + 3))).toEqual([
			{ type: 'event', event: { type: 'connected' } }
		]);
		expect(decoder.push(bytes.slice(connected.length + 3))).toEqual([
			{
				type: 'audio',
				frame: {
					encoding: 'pcm_s16le',
					channels: 1,
					sampleRate: 24000,
					samples: new Int16Array([-32768, 0, 32767])
				}
			}
		]);
		expect(() => decoder.finish()).not.toThrow();
	});

	it('rejects malformed and incomplete packets', () => {
		const incomplete = encodeRealtimeEvent({ type: 'heartbeat' }).slice(0, 6);
		const decoder = new RealtimeEventDecoder();
		decoder.push(incomplete);

		expect(() => decoder.finish()).toThrow('incomplete packet');
		expect(() => new RealtimeEventDecoder().push(new Uint8Array([9, 1, 0, 0, 0, 1]))).toThrow(
			'Unknown realtime event packet type'
		);
	});
});

function concatenate(...parts: Uint8Array[]): Uint8Array {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}
