import { json } from '@sveltejs/kit';
import { createRealtimeSttSession } from '$lib/server/realtime-stt-sessions';
import type { RequestHandler } from './$types';

type RealtimeSttRequest = {
	provider?: unknown;
	model?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json().catch(() => ({}))) as RealtimeSttRequest;
		if (body.provider !== undefined && body.provider !== 'openai') {
			return json({ error: 'Unsupported realtime transcription provider' }, { status: 400 });
		}
		const model = typeof body.model === 'string' ? body.model.trim() : '';
		if (model.length > 200) {
			return json({ error: 'Transcription model ID is too long' }, { status: 400 });
		}
		const record = await createRealtimeSttSession({ model });
		return json({ id: record.id, sampleRate: 24000 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not start realtime transcription' },
			{ status: 503 }
		);
	}
};
