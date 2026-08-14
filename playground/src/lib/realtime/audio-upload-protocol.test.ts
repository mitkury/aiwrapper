import { describe, expect, it } from 'vitest';
import { AudioUploadDecoder, encodeAudioPacket } from './audio-upload-protocol';

describe('realtime audio upload protocol', () => {
	it('decodes audio packets across arbitrary network chunks', () => {
		const audio = encodeAudioPacket(new Uint8Array([1, 0, 254, 255]));
		const decoder = new AudioUploadDecoder();

		expect(decoder.push(audio.slice(0, 3))).toEqual([]);
		expect(decoder.push(audio.slice(3, 6))).toEqual([]);
		expect(decoder.push(audio.slice(6))).toEqual([new Uint8Array([1, 0, 254, 255])]);
		expect(() => decoder.finish()).not.toThrow();
	});

	it('rejects incomplete and malformed packets', () => {
		const decoder = new AudioUploadDecoder();
		decoder.push(encodeAudioPacket(new Uint8Array([1, 0])).slice(0, 5));
		expect(() => decoder.finish()).toThrow('incomplete packet');
		expect(() => new AudioUploadDecoder().push(new Uint8Array([3, 0, 0, 0]))).toThrow(
			'invalid length'
		);
	});
});
