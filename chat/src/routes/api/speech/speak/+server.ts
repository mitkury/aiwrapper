import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { TextToSpeech, type PcmAudioFrame } from 'aiwrapper/unstable/speech';
import type { RequestHandler } from './$types';
import { pcmResponse, speechError } from '$lib/server/speech-response';

type SpeakRequest = {
	provider?: unknown;
	text?: unknown;
	voice?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as SpeakRequest;
		const providerName = body.provider === 'elevenlabs' ? 'elevenlabs' : 'openai';
		const text = typeof body.text === 'string' ? body.text.trim() : '';
		const voice = typeof body.voice === 'string' ? body.voice.trim() : '';

		if (!text) return json({ error: 'Text is required' }, { status: 400 });
		if (text.length > 5000)
			return json({ error: 'Text is limited to 5,000 characters' }, { status: 400 });

		const provider =
			providerName === 'elevenlabs' ? createElevenLabsProvider(voice) : createOpenAIProvider();
		const frames: PcmAudioFrame[] = [];

		for await (const frame of provider.speak(text, {
			signal: request.signal,
			...(voice ? { voice } : {})
		})) {
			frames.push(frame);
		}

		return pcmResponse(frames);
	} catch (error) {
		return speechError(error);
	}
};

function createOpenAIProvider() {
	if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
	return TextToSpeech.openai({
		apiKey: env.OPENAI_API_KEY,
		model: env.OPENAI_TTS_MODEL || undefined,
		voice: env.OPENAI_TTS_VOICE || undefined
	});
}

function createElevenLabsProvider(voice: string) {
	if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not configured');
	const voiceId = voice || env.ELEVENLABS_VOICE_ID;
	if (!voiceId) throw new Error('An ElevenLabs voice ID is required');
	return TextToSpeech.elevenlabs({
		apiKey: env.ELEVENLABS_API_KEY,
		voiceId,
		model: env.ELEVENLABS_TTS_MODEL || undefined,
		sampleRate: 24000
	});
}
