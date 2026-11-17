import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nativeTranscribe, speechError } from '$lib/server/native-speech';

const maximumAudioBytes = 24 * 1024 * 1024 - 44;

export const POST: RequestHandler = async ({ request }) => {
	try {
		if (!env.OPENAI_API_KEY) {
			return json({ error: 'OPENAI_API_KEY is not configured' }, { status: 503 });
		}

		const sampleRate = Number(request.headers.get('x-audio-sample-rate'));
		if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
			return json({ error: 'A valid X-Audio-Sample-Rate header is required' }, { status: 400 });
		}

		const bytes = await request.arrayBuffer();
		if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
			return json({ error: 'Body must contain non-empty signed 16-bit PCM' }, { status: 400 });
		}
		if (bytes.byteLength > maximumAudioBytes) {
			return json({ error: 'Recording is too large for transcription' }, { status: 413 });
		}

		return await nativeTranscribe(bytes, sampleRate, request.signal);
	} catch (error) {
		return speechError(error);
	}
};
