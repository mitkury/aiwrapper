import { models, setHttpRequestImpl, type Model } from 'aiwrapper';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createLanguageProvider,
	getModelIdForProvider,
	getProviderConfig,
	getProviderModel,
	getProviderModels
} from './provider-config.js';

afterEach(() => {
	setHttpRequestImpl((url, options) => globalThis.fetch(url, options));
});

describe('chat provider configuration', () => {
	const openRouter = getProviderConfig('openrouter');

	it('keeps explicit model selections and restores the server default when cleared', () => {
		const provider = getProviderConfig('openai');
		expect(getProviderModel(provider, { OPENAI_MODEL: 'gpt-5.4' }, 'gpt-5.6-sol')).toBe('gpt-5.4');
		expect(getProviderModel(provider, { OPENAI_MODEL: '' }, 'gpt-5.4-mini')).toBe('gpt-5.4-mini');
		expect(getProviderModel(provider, {}, 'gpt-5.4-mini')).toBe('gpt-5.4-mini');
	});

	it('sends the Groq default with its required API prefix', async () => {
		let requestBody: Record<string, unknown> | undefined;
		setHttpRequestImpl(async (_url, options) => {
			requestBody = JSON.parse(String(options.body));
			return streamingTextResponse('Ready.');
		});
		await createLanguageProvider(
			'groq',
			{ GROQ_API_KEY: 'test-key' },
			{ optimizeForLatency: true }
		).ask('Hi');
		expect(requestBody).toMatchObject({
			model: 'openai/gpt-oss-120b',
			reasoning_effort: 'low',
			include_reasoning: false
		});
	});

	it.each(['anthropic', 'deepseek'] as const)(
		'explicitly disables default thinking for realtime %s',
		async (id) => {
			const provider = getProviderConfig(id);
			let requestBody: Record<string, unknown> | undefined;
			setHttpRequestImpl(async (_url, options) => {
				requestBody = JSON.parse(String(options.body));
				return id === 'anthropic'
					? new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n')
					: streamingTextResponse('Ready.');
			});
			await createLanguageProvider(
				id,
				{ [provider.apiKeyEnvironmentKey!]: 'test-key' },
				{ optimizeForLatency: true }
			).ask('Hi');
			expect(requestBody).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 256 });
			expect(requestBody).not.toHaveProperty('temperature');
		}
	);

	it('only offers catalog models exposed by OpenRouter', () => {
		const providerModels = getProviderModels(openRouter);

		expect(providerModels.length).toBeGreaterThan(0);
		expect(providerModels.every((model) => model.canChat())).toBe(true);
		expect(
			providerModels.every((model) =>
				model.providers.some((provider) => provider.id === 'openrouter')
			)
		).toBe(true);
	});

	it('falls back when a saved catalog model is no longer exposed', () => {
		const providerModelIds = new Set(getProviderModels(openRouter).map((model) => model.id));
		const unavailableModel = Array.from(models).find(
			(model) => model.canChat() && !providerModelIds.has(model.id)
		);
		expect(unavailableModel).toBeDefined();

		const selected = getProviderModel(openRouter, {
			OPENROUTER_MODEL: unavailableModel?.id ?? ''
		});

		expect(providerModelIds.has(selected)).toBe(true);
	});

	it('resolves canonical catalog IDs at the request boundary', () => {
		const model = getProviderModels(openRouter).find((candidate) =>
			Boolean(expectedOpenRouterId(candidate))
		);
		expect(model).toBeDefined();

		expect(getModelIdForProvider(openRouter, model?.id ?? '')).toBe(expectedOpenRouterId(model));
	});

	it('sends an explicitly bounded non-thinking Kimi request in latency mode', async () => {
		let requestBody: Record<string, unknown> | undefined;
		setHttpRequestImpl(async (_url, options) => {
			requestBody = JSON.parse(String(options.body)) as Record<string, unknown>;
			return streamingTextResponse('Ready.');
		});

		const language = createLanguageProvider(
			'kimi',
			{ KIMI_API_KEY: 'test-key', KIMI_MODEL: 'kimi-k2.5' },
			{ optimizeForLatency: true }
		);
		await language.ask('Hello');

		expect(requestBody).toMatchObject({
			thinking: { type: 'disabled' },
			max_completion_tokens: 256
		});
		expect(requestBody).not.toHaveProperty('max_tokens');
	});

	it('requests the lowest-latency OpenRouter path without reasoning', async () => {
		let requestBody: Record<string, unknown> | undefined;
		setHttpRequestImpl(async (_url, options) => {
			requestBody = JSON.parse(String(options.body)) as Record<string, unknown>;
			return streamingTextResponse('Ready.');
		});

		const language = createLanguageProvider(
			'openrouter',
			{ OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'gpt-5-mini' },
			{ optimizeForLatency: true }
		);
		await language.ask('Hello');

		expect(requestBody).toMatchObject({
			provider: { sort: 'latency' },
			reasoning: { effort: 'none' },
			max_tokens: 256
		});
	});
});

function streamingTextResponse(text: string): Response {
	const events = [
		{ choices: [{ delta: { role: 'assistant' } }] },
		{ choices: [{ delta: { content: text } }] }
	];
	return new Response(
		`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
		{
			status: 200,
			headers: { 'Content-Type': 'text/event-stream' }
		}
	);
}

function expectedOpenRouterId(model: Model | undefined): string | undefined {
	if (!model) return undefined;
	const providerAwareModel = model as Model & {
		idFor?: (providerId: string) => string | undefined;
	};
	return (
		providerAwareModel.idFor?.('openrouter') ??
		(model.creatorId ? `${model.creatorId}/${model.id}` : undefined)
	);
}
