import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getRealtimeAgentSession,
	setRealtimeAgentImage
} from '$lib/server/realtime-agent-sessions';

const maximumImageBytes = 2 * 1024 * 1024;

export const POST: RequestHandler = async ({ params, request }) => {
	const record = getRealtimeAgentSession(params.sessionId);
	if (!record) return json({ error: 'Unknown realtime session' }, { status: 404 });
	const mimeType = request.headers.get('content-type')?.split(';', 1)[0] || '';
	if (!mimeType.startsWith('image/')) return json({ error: 'Expected an image' }, { status: 415 });
	const declaredLength = Number(request.headers.get('content-length'));
	if (declaredLength > maximumImageBytes)
		return json({ error: 'Image is too large' }, { status: 413 });
	const blob = await request.blob();
	if (!blob.size || blob.size > maximumImageBytes) {
		return json({ error: blob.size ? 'Image is too large' : 'Image is empty' }, { status: 400 });
	}
	setRealtimeAgentImage(record, { blob, mimeType });
	return new Response(null, { status: 204 });
};
