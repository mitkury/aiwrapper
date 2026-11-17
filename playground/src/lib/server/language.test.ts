import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageConfig, chatConfig } from './language';
import { nativeChat } from './native-chat';
import { POST } from '../../routes/api/chat/+server';
import { runChat } from '../chat';
import { filterProviderPreferences } from '../provider-settings.svelte';

const environment = vi.hoisted(() => ({
	AIWRAPPER_NATIVE_MOCK: '',
	OPENROUTER_API_KEY: 'server-key',
	OPENROUTER_MODEL: 'gpt-5-mini',
	OLLAMA_URL: 'http://ollama.test:11434',
	OPENAI_COMPATIBLE_BASE_URL: 'https://compatible.test/v1',
	OPENAI_COMPATIBLE_MODEL: 'local-model'
}));
vi.mock('$env/dynamic/private', () => ({ env: environment }));
vi.mock('./native-chat', () => ({ nativeChat: vi.fn(() => new Response('{"done":true}\n')) }));

afterEach(() => {
	environment.AIWRAPPER_NATIVE_MOCK = '';
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

function request(body: unknown) {
	return POST({
		request: new Request('http://localhost/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0]);
}

describe('shared server credentials', () => {
	it('makes only native mock chat available without credentials', () => {
		environment.AIWRAPPER_NATIVE_MOCK = '1';
		expect(chatConfig().openai.configured).toBe(true);
		expect(languageConfig().openai.configured).toBe(false);
	});
	it('reports availability and model defaults without exposing credentials', () => {
		const config = languageConfig();
		expect(config.openrouter).toEqual({
			configured: true,
			environmentKey: 'OPENROUTER_API_KEY',
			model: 'gpt-5-mini'
		});
		expect(config.openai.configured).toBe(false);
		expect(config['openai-compatible'].configured).toBe(true);
		expect(JSON.stringify(config)).not.toContain('server-key');
	});

	it('migrates only preferences, dropping keys and browser endpoint overrides', () => {
		expect(
			filterProviderPreferences({
				LLM_PROVIDER: 'openrouter',
				OPENROUTER_MODEL: 'gpt-5-mini',
				OPENROUTER_API_SECRET: 'old-key',
				OPENAI_API_KEY: 'other-key',
				OPENAI_COMPATIBLE_BASE_URL: 'https://old.test',
				REALTIME_STT_PROVIDER: 'deepgram'
			})
		).toEqual({
			LLM_PROVIDER: 'openrouter',
			OPENROUTER_MODEL: 'gpt-5-mini',
			REALTIME_STT_PROVIDER: 'deepgram'
		});
	});
});

describe('server chat transport', () => {
	const input = {
		provider: 'openrouter',
		model: 'gpt-5-mini',
		messages: [{ role: 'user', items: [{ type: 'text', text: 'Hi' }] }]
	};

	it('routes keyless mock chat to Rust with only the permitted browser fields', async () => {
		environment.AIWRAPPER_NATIVE_MOCK = '1';
		const response = await request({
			...input,
			provider: 'openai',
			model: '',
			apiKey: 'browser-key',
			baseURL: 'https://untrusted.test'
		});
		expect(response.status).toBe(200);
		expect(nativeChat).toHaveBeenCalledOnce();
		expect(vi.mocked(nativeChat).mock.calls[0][0]).toEqual({
			provider: 'openai',
			model: languageConfig().openai.model,
			messages: input.messages
		});
	});

	it('always routes configured chat to Rust without a runtime flag', async () => {
		const response = await request({
			...input,
			apiKey: 'browser-key',
			baseURL: 'https://untrusted.test'
		});
		expect(response.status).toBe(200);
		expect(nativeChat).toHaveBeenCalledWith(input, expect.any(AbortSignal));
	});
	it('rejects unknown providers and missing credentials before spawning Rust', async () => {
		expect((await request({ ...input, provider: 'unknown' })).status).toBe(400);
		expect((await request({ ...input, provider: 'openai' })).status).toBe(503);
		expect(nativeChat).not.toHaveBeenCalled();
	});

	it('retains streamed partial messages when the server reports a failure', async () => {
		const event = { messages: input.messages, done: true, error: 'Provider failed' };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(event) + '\n'))
		);
		const update = vi.fn();
		await expect(
			runChat('openrouter', 'gpt-5-mini', [], update, new AbortController().signal)
		).rejects.toThrow('Provider failed');
		expect(update).toHaveBeenCalledWith(event);
	});

	it('handles split UTF-8 and rejects an incomplete stream', async () => {
		const event = {
			messages: [{ role: 'assistant', items: [{ type: 'text', text: 'Olá' }] }],
			done: true
		};
		const bytes = new TextEncoder().encode(JSON.stringify(event) + '\n');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
								controller.close();
							}
						})
					)
			)
		);
		const update = vi.fn();
		await runChat('openrouter', 'gpt-5-mini', [], update, new AbortController().signal);
		expect(update).toHaveBeenCalledWith(event);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(''))
		);
		await expect(
			runChat('openrouter', 'gpt-5-mini', [], update, new AbortController().signal)
		).rejects.toThrow('before completion');
	});
});
