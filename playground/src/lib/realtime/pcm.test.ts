import { describe, expect, it } from 'vitest';
import { pcmBytesToSamples, pcmSamplesToBytes, resampleToPcm } from './pcm';

describe('PCM media helpers', () => {
	it('converts signed samples to little-endian bytes and back', () => {
		const samples = new Int16Array([1, -2, 32767, -32768]);
		const bytes = pcmSamplesToBytes(samples);

		expect(bytes).toEqual(new Uint8Array([1, 0, 254, 255, 255, 127, 0, 128]));
		expect(pcmBytesToSamples(bytes)).toEqual(samples);
	});

	it('rejects incomplete PCM bytes', () => {
		expect(() => pcmBytesToSamples(new Uint8Array())).toThrow('non-empty');
		expect(() => pcmBytesToSamples(new Uint8Array([1]))).toThrow('signed 16-bit');
	});

	it('resamples browser audio and clamps it to signed 16-bit PCM', () => {
		expect(resampleToPcm(new Float32Array([-2, 0, 2]), 3, 3)).toEqual(
			new Int16Array([-32768, 0, 32767])
		);
		expect(resampleToPcm(new Float32Array([0, 1]), 2, 4)).toEqual(
			new Int16Array([0, 16383, 32767, 32767])
		);
	});
});
