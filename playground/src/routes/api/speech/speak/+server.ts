import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { nativeSpeak, speechError } from '$lib/server/native-speech';

type SpeakRequest = {
	provider?: unknown;
	text?: unknown;
	voice?: unknown;
	model?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as SpeakRequest;
		if (body.provider !== 'openai' && body.provider !== 'elevenlabs') {
			return json({ error: 'Unsupported speech provider' }, { status: 400 });
		}
		const providerName = body.provider;
		const text = typeof body.text === 'string' ? body.text.trim() : '';
		const voice = typeof body.voice === 'string' ? body.voice.trim() : '';
		const model = typeof body.model === 'string' ? body.model.trim() : '';

		if (!text) return json({ error: 'Text is required' }, { status: 400 });
		if (text.length > 5000)
			return json({ error: 'Text is limited to 5,000 characters' }, { status: 400 });

		if (model.length > 200) return json({ error: 'Speech model ID is too long' }, { status: 400 });

		const elevenlabs = providerName === 'elevenlabs';
		return await nativeSpeak(
			{
				provider: providerName,
				text,
				model:
					model ||
					(elevenlabs
						? env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5'
						: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'),
				voice:
					voice || (elevenlabs ? env.ELEVENLABS_VOICE_ID || '' : env.OPENAI_TTS_VOICE || 'coral')
			},
			request.signal
		);
	} catch (error) {
		return speechError(error);
	}
};
