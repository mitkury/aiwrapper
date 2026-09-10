import { json } from '@sveltejs/kit';
import { createTextToSpeech } from '$lib/server/realtime-speech';
import type { RequestHandler } from './$types';
import { pcmStreamResponse, speechError } from '$lib/server/speech-response';

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

		const provider = createTextToSpeech({ provider: providerName, voice, model });
		const frames = provider.speak(text, {
			signal: request.signal,
			...(voice ? { voice } : {})
		});

		return await pcmStreamResponse(frames, provider.outputFormat);
	} catch (error) {
		return speechError(error);
	}
};
