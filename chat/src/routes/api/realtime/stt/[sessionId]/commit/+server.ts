import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	commitRealtimeSttAudio,
	getRealtimeSttSession
} from '$lib/server/realtime-stt-sessions';

export const POST: RequestHandler = async ({ params }) => {
	const record = getRealtimeSttSession(params.sessionId);
	if (!record) return json({ error: 'Unknown realtime transcription session' }, { status: 404 });
	try {
		return json(await commitRealtimeSttAudio(record));
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not commit audio' },
			{ status: 500 }
		);
	}
};
