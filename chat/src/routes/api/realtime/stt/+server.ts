import { json } from '@sveltejs/kit';
import { createRealtimeSttSession } from '$lib/server/realtime-stt-sessions';

export async function POST() {
	try {
		const record = await createRealtimeSttSession();
		return json({ id: record.id, sampleRate: 24000 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not start realtime transcription' },
			{ status: 503 }
		);
	}
}
