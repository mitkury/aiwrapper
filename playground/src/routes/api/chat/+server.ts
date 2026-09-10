import { ChatAgent, LangMessages } from 'aiwrapper';
import { json } from '@sveltejs/kit';
import { getProviderConfig, isProviderId } from '$lib/provider-config';
import { createServerLanguageProvider, languageConfig } from '$lib/server/language';
import type { ChatEvent, ChatMessage } from '$lib/chat';
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
	if (!languageConfig()[providerId].configured) {
		return json(
			{ error: `${getProviderConfig(providerId).label} is not configured in .env` },
			{ status: 503 }
		);
	}
	const provider = getProviderConfig(providerId);
	const agent = new ChatAgent(createServerLanguageProvider(providerId, body.model), {
		tools: provider.supportsOpenAIBuiltInTools
			? [{ name: 'web_search' }, { name: 'image_generation' }]
			: []
	});
	agent.messages = new LangMessages(body.messages);
	const abortController = new AbortController();
	const signal = AbortSignal.any([request.signal, abortController.signal]);
	const encoder = new TextEncoder();
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (extra: Partial<ChatEvent> = {}) => {
				if (!cancelled)
					controller.enqueue(
						encoder.encode(JSON.stringify({ messages: agent.messages, ...extra }) + '\n')
					);
			};
			const unsubscribe = agent.subscribe((event) => {
				if (event.type === 'streaming') send();
			});
			void agent
				.run(undefined, { signal })
				.then(
					() => send({ done: true }),
					(error: unknown) =>
						send({
							done: true,
							error: error instanceof Error ? error.message : 'Chat request failed'
						})
				)
				.finally(() => {
					unsubscribe();
					if (!cancelled) controller.close();
				});
		},
		cancel() {
			cancelled = true;
			abortController.abort();
		}
	});
	return new Response(stream, {
		headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' }
	});
};
