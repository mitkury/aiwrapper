import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type ElevenLabsVoice = {
	voice_id?: unknown;
	name?: unknown;
};

export const GET: RequestHandler = async ({ fetch, url }) => {
	if (url.searchParams.get('provider') !== 'elevenlabs') {
		return json({ error: 'Unsupported voice provider' }, { status: 400 });
	}
	if (!env.ELEVENLABS_API_KEY) {
		return json({ error: 'ELEVENLABS_API_KEY is not configured' }, { status: 503 });
	}

	try {
		const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
			headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }
		});
		if (!response.ok) {
			return json({ error: 'Could not load ElevenLabs voices' }, { status: response.status });
		}
		const body = (await response.json()) as { voices?: ElevenLabsVoice[] };
		const voices = (body.voices ?? [])
			.map((voice) => ({
				id: typeof voice.voice_id === 'string' ? voice.voice_id : '',
				name: typeof voice.name === 'string' ? voice.name : ''
			}))
			.filter((voice) => voice.id && voice.name)
			.sort((left, right) => left.name.localeCompare(right.name));
		return json({ voices });
	} catch {
		return json({ error: 'Could not load ElevenLabs voices' }, { status: 502 });
	}
};
