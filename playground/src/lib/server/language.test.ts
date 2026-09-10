import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHttpRequestImpl } from 'aiwrapper';
import { languageConfig, createServerLanguageProvider } from './language';
import { POST } from '../../routes/api/chat/+server';
import { runChat } from '../chat';
import { filterProviderPreferences } from '../provider-settings.svelte';

const environment = vi.hoisted(() => ({
	OPENROUTER_API_KEY: 'server-key',
	OPENROUTER_MODEL: 'gpt-5-mini',
	OLLAMA_URL: 'http://ollama.test:11434',
	OPENAI_COMPATIBLE_BASE_URL: 'https://compatible.test/v1',
	OPENAI_COMPATIBLE_MODEL: 'local-model'
}));
vi.mock('$env/dynamic/private', () => ({ env: environment }));

afterEach(() => {
	vi.unstubAllGlobals();
	setHttpRequestImpl((url, options) => globalThis.fetch(url, options));
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

function textResponse(text: string) {
	return new Response(
		`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: text } }] })}\n\ndata: [DONE]\n\n`,
		{
			headers: { 'Content-Type': 'text/event-stream' }
		}
	);
}

describe('shared server credentials', () => {
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

	it.each([false, true])(
		'uses the same environment key in latency mode %s',
		async (optimizeForLatency) => {
			let headers: Headers | undefined;
			setHttpRequestImpl(async (_url, options) => {
				headers = new Headers(options.headers);
				return textResponse('Hello');
			});
			await createServerLanguageProvider('openrouter', '', { optimizeForLatency }).ask('Hi');
			expect(headers?.get('authorization')).toBe('Bearer server-key');
		}
	);

	it('honors OLLAMA_URL and permits a keyless compatible endpoint', async () => {
		const urls: string[] = [];
		setHttpRequestImpl(async (url) => {
			urls.push(String(url));
			return textResponse('Hello');
		});
		await createServerLanguageProvider('ollama', 'llama2:latest').ask('Hi');
		await createServerLanguageProvider('openai-compatible', '').ask('Hi');
		expect(urls[0]).toContain('http://ollama.test:11434');
		expect(urls[1]).toContain('https://compatible.test/v1');
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

	it('streams a complete conversation using only server credentials', async () => {
		setHttpRequestImpl(async (_url, options) => {
			expect(new Headers(options.headers).get('authorization')).toBe('Bearer server-key');
			return textResponse('Hello');
		});
		const response = await request({
			...input,
			apiKey: 'browser-key',
			baseURL: 'https://untrusted.test'
		});
		expect(response.status).toBe(200);
		const events = (await response.text())
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(events.some((event) => !event.done)).toBe(true);
		expect(events.at(-1)).toMatchObject({
			done: true,
			messages: [input.messages[0], { role: 'assistant', items: [{ type: 'text', text: 'Hello' }] }]
		});
		expect(JSON.stringify(events)).not.toContain('server-key');
	});

	it('rejects unknown providers and missing server credentials before requesting a model', async () => {
		const upstream = vi.fn();
		setHttpRequestImpl(upstream);
		expect((await request({ ...input, provider: 'unknown' })).status).toBe(400);
		expect((await request({ ...input, provider: 'openai' })).status).toBe(503);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('aborts the upstream request when the response reader is cancelled', async () => {
		let upstreamSignal: AbortSignal | undefined;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		setHttpRequestImpl(async (_url, options) => {
			upstreamSignal = options.signal as AbortSignal;
			started();
			return new Promise<Response>((_resolve, reject) => {
				upstreamSignal!.addEventListener(
					'abort',
					() => reject(new DOMException('Aborted', 'AbortError')),
					{ once: true }
				);
			});
		});
		const response = await request(input);
		await ready;
		await response.body!.cancel();
		expect(upstreamSignal?.aborted).toBe(true);
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
