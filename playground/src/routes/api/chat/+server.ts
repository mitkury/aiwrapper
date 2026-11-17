import { nativeChat } from '$lib/server/native-chat';
import { json } from '@sveltejs/kit';
import { getProviderConfig, isProviderId } from '$lib/provider-config';
import { chatConfig } from '$lib/server/language';
import type { ChatMessage } from '$lib/chat';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const providerId = body?.provider;
	if (
		!body ||
		!isProviderId(providerId) ||
		typeof body.model !== 'string' ||
		body.model.length > 200 ||
		!Array.isArray(body.messages) ||
		!body.messages.every(
			(message: ChatMessage) =>
				message &&
				['user', 'assistant', 'tool-results'].includes(message.role) &&
				Array.isArray(message.items)
		)
	) {
		return json({ error: 'A valid provider, model, and messages are required' }, { status: 400 });
	}
	const config = chatConfig()[providerId];
	if (!config.configured) {
		return json(
			{ error: `${getProviderConfig(providerId).label} is not configured in .env` },
			{ status: 503 }
		);
	}
	return nativeChat(
		{
			provider: providerId,
			model: body.model.trim() || config.model,
			messages: body.messages
		},
		request.signal
	);
};
