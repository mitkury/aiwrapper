import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { SpeechToText } from 'aiwrapper';
import type { RequestHandler } from './$types';
import { speechError } from '$lib/server/speech-response';

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

		const source = new DataView(bytes);
		const samples = new Int16Array(bytes.byteLength / 2);
		for (let index = 0; index < samples.length; index++) {
			samples[index] = source.getInt16(index * 2, true);
		}

		const provider = SpeechToText.openai({
			apiKey: env.OPENAI_API_KEY,
			model: env.OPENAI_TRANSCRIPTION_MODEL || undefined
		});
		const session = await provider.createSession({ signal: request.signal });
		try {
			await session.appendAudio({
				encoding: 'pcm_s16le',
				channels: 1,
				sampleRate,
				samples
			});
			return json(await session.finish());
		} finally {
			await session.close();
		}
	} catch (error) {
		return speechError(error);
	}
};
