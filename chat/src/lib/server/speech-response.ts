import { json } from '@sveltejs/kit';
import type { PcmAudioFrame } from 'aiwrapper/unstable/speech';

export function pcmResponse(frames: readonly PcmAudioFrame[]): Response {
	if (frames.length === 0) {
		throw new Error('Speech provider returned no audio frames');
	}

	const sampleRate = frames[0].sampleRate;
	const sampleCount = frames.reduce((total, frame) => {
		if (frame.sampleRate !== sampleRate) {
			throw new Error('Speech provider changed sample rate within one response');
		}
		return total + frame.samples.length;
	}, 0);
	const bytes = new Uint8Array(sampleCount * 2);
	const view = new DataView(bytes.buffer);
	let byteOffset = 0;

	for (const frame of frames) {
		for (const sample of frame.samples) {
			view.setInt16(byteOffset, sample, true);
			byteOffset += 2;
		}
	}

	return new Response(bytes, {
		headers: {
			'Content-Type': 'audio/pcm',
			'X-Audio-Encoding': 'pcm_s16le',
			'X-Audio-Channels': '1',
			'X-Audio-Sample-Rate': String(sampleRate)
		}
	});
}

export function speechError(error: unknown): Response {
	console.error('Speech playground request failed', error);
	return json(
		{ error: error instanceof Error ? error.message : 'Speech request failed' },
		{ status: 500 }
	);
}
