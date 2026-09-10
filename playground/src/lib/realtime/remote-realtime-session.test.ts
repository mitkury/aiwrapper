import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteRealtimeSession, type RemoteRealtimeEvent } from './remote-realtime-session';
import { encodeRealtimeEvent } from './realtime-session-protocol';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('RemoteRealtimeSession', () => {
	it('uses the server session for text input and streamed events', async () => {
		const requests: Array<{ url: string; method: string; body?: string }> = [];
		const { fetchMock } = sessionFetchMock(requests, [
			{ type: 'connected' },
			{ type: 'transcript', speaker: 'assistant', text: 'Hello', final: true }
		]);
		vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost/realtime' });
		vi.stubGlobal('fetch', fetchMock);
		const events: RemoteRealtimeEvent[] = [];
		const session = new RemoteRealtimeSession(config());
		session.subscribe((event) => events.push(event));

		await session.connect();
		await session.sendText('Hi');
		await session.close();

		expect(events).toContainEqual({
			type: 'transcript',
			speaker: 'assistant',
			text: 'Hello',
			final: true
		});
		expect(requests).toContainEqual({
			url: '/api/realtime/sessions/session-1/text',
			method: 'POST',
			body: JSON.stringify({ text: 'Hi' })
		});
		expect(requests.at(-1)).toMatchObject({
			url: '/api/realtime/sessions/session-1',
			method: 'DELETE'
		});
	});

	it('turns structured server failures into readable client errors', async () => {
		const { fetchMock } = sessionFetchMock(
			[],
			[
				{ type: 'connected' },
				{
					type: 'error',
					error: {
						provider: 'OpenAI LLM',
						message: 'Rate limit reached',
						status: 429,
						code: 'rate_limit_exceeded',
						requestId: 'req_123'
					}
				}
			]
		);
		vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost/realtime' });
		vi.stubGlobal('fetch', fetchMock);
		const errors: string[] = [];
		const session = new RemoteRealtimeSession(config());
		session.subscribe((event) => {
			if (event.type === 'error') errors.push(event.error.message);
		});

		await session.connect();
		await session.close();

		expect(errors).toEqual([
			'OpenAI LLM: (HTTP 429, rate_limit_exceeded, request req_123) Rate limit reached'
		]);
	});
});

function sessionFetchMock(
	requests: Array<{ url: string; method: string; body?: string }>,
	events: Parameters<typeof encodeRealtimeEvent>[0][]
) {
	let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;
	const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = String(input);
		const method = init.method || 'GET';
		requests.push({
			url,
			method,
			...(typeof init.body === 'string' ? { body: init.body } : {})
		});
		if (url === '/api/realtime/sessions' && method === 'POST') {
			return Response.json({ id: 'session-1', inputSampleRate: 24000 });
		}
		if (url === '/api/realtime/sessions/session-1' && method === 'GET') {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					eventController = controller;
					for (const event of events) controller.enqueue(encodeRealtimeEvent(event));
				}
			});
			init.signal?.addEventListener(
				'abort',
				() => {
					try {
						eventController?.close();
					} catch {
						// The stream may have already been cancelled by the reader.
					}
				},
				{ once: true }
			);
			return new Response(stream, {
				headers: { 'Content-Type': 'application/x-aiwrapper-realtime-events' }
			});
		}
		return new Response(null, { status: method === 'POST' ? 202 : 204 });
	});
	return { fetchMock };
}

function config() {
	return {
		stt: { provider: 'openai' as const, model: 'gpt-4o-mini-transcribe' },
		llm: { provider: 'openai' as const, model: 'gpt-5.4' },
		tts: { provider: 'openai' as const, model: 'gpt-4o-mini-tts', voice: 'coral' }
	};
}
