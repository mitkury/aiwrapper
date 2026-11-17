import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cascadeCommand, stopCascade } from '$lib/server/native-cascade';
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const text = await request.text();
		if (text.length > 3 * 1024 * 1024) return json({ error: 'Command too large' }, { status: 413 });
		await cascadeCommand(params.sessionId, JSON.parse(text));
		return new Response(null, { status: 204 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Command failed' },
			{ status: 400 }
		);
	}
};
export const DELETE: RequestHandler = ({ params }) => {
	stopCascade(params.sessionId);
	return new Response(null, { status: 204 });
};
