import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getRealtimeAgentSession,
	sendRealtimeAgentText
} from '$lib/server/realtime-agent-sessions';

export const POST: RequestHandler = async ({ params, request }) => {
	const record = getRealtimeAgentSession(params.sessionId);
	if (!record) return json({ error: 'Unknown realtime session' }, { status: 404 });
	const body = (await request.json().catch(() => ({}))) as { text?: unknown };
	const text = typeof body.text === 'string' ? body.text.trim() : '';
	if (!text) return json({ error: 'Text is required' }, { status: 400 });
	if (text.length > 10_000) return json({ error: 'Text is too long' }, { status: 400 });
	sendRealtimeAgentText(record, text);
	return new Response(null, { status: 202 });
};
