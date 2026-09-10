export function resampleToPcm(
	input: Float32Array,
	sourceRate: number,
	targetRate: number
): Int16Array {
	const length = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
	const output = new Int16Array(length);
	for (let index = 0; index < length; index++) {
		const sourcePosition = (index * sourceRate) / targetRate;
		const left = Math.min(input.length - 1, Math.floor(sourcePosition));
		const right = Math.min(input.length - 1, left + 1);
		const fraction = sourcePosition - left;
		const sample = Math.max(
			-1,
			Math.min(1, input[left] * (1 - fraction) + input[right] * fraction)
		);
		output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
	}
	return output;
}

export function pcmSamplesToBytes(samples: Int16Array): Uint8Array {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < samples.length; index++) {
		view.setInt16(index * 2, samples[index], true);
	}
	return bytes;
}

export function pcmBytesToSamples(bytes: Uint8Array): Int16Array {
	if (!bytes.byteLength || bytes.byteLength % 2 !== 0) {
		throw new Error('Audio must be non-empty signed 16-bit PCM');
	}
	const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const samples = new Int16Array(bytes.byteLength / 2);
	for (let index = 0; index < samples.length; index++) {
		samples[index] = source.getInt16(index * 2, true);
	}
	return samples;
}
