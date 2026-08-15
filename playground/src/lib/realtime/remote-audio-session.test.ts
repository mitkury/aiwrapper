import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAudioSession, type RemoteAudioSessionEvent } from './remote-audio-session';
import { encodeRealtimeEvent } from './realtime-session-protocol';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('RemoteAudioSession', () => {
	it('uses the server input rate and sends fallback PCM audio', async () => {
		const requests: Array<{
			url: string;
			method: string;
			sampleRate?: string;
			body?: ArrayBuffer;
		}> = [];
		vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost/playground' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
				const url = String(input);
				const method = init.method || 'GET';
				requests.push({
					url,
					method,
					...(init.headers instanceof Object && 'X-Audio-Sample-Rate' in init.headers
						? { sampleRate: String(init.headers['X-Audio-Sample-Rate']) }
						: {}),
					...(init.body instanceof ArrayBuffer ? { body: init.body } : {})
				});
				if (url === '/sessions' && method === 'POST') {
					return Response.json({ id: 'session-1', inputSampleRate: 16000 });
				}
				if (url === '/sessions/session-1' && method === 'GET') {
					return eventResponse([{ type: 'connected' }], init.signal);
				}
				return new Response(null, { status: method === 'POST' ? 202 : 204 });
			})
		);
		const session = createSession();

		await session.connect();
		await session.sendAudio({
			encoding: 'pcm_s16le',
			channels: 1,
			sampleRate: 16000,
			samples: new Int16Array([1, -2])
		});
		await session.close();

		expect(session.inputSampleRate).toBe(16000);
		expect(requests).toContainEqual({
			url: '/sessions/session-1',
			method: 'POST',
			sampleRate: '16000',
			body: new Uint8Array([1, 0, 254, 255]).buffer
		});
		expect(requests.at(-1)).toMatchObject({ url: '/sessions/session-1', method: 'DELETE' });
	});

	it('rejects overlapping connection attempts', async () => {
		let releaseStart: ((response: Response) => void) | undefined;
		const startResponse = new Promise<Response>((resolve) => {
			releaseStart = resolve;
		});
		vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost/playground' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
				const url = String(input);
				const method = init.method || 'GET';
				if (url === '/sessions' && method === 'POST') return startResponse;
				if (url === '/sessions/session-1' && method === 'GET') {
					return eventResponse([{ type: 'connected' }], init.signal);
				}
				return new Response(null, { status: 204 });
			})
		);
		const session = createSession();

		const first = session.connect();
		await expect(session.connect()).rejects.toThrow('already connecting');
		releaseStart?.(Response.json({ id: 'session-1', inputSampleRate: 24000 }));
		await first;
		await session.close();
	});

	it('deletes sessions that return an invalid input rate', async () => {
		const requests: Array<{ url: string; method: string }> = [];
		vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost/playground' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
				const request = { url: String(input), method: init.method || 'GET' };
				requests.push(request);
				if (request.url === '/sessions' && request.method === 'POST') {
					return Response.json({ id: 'bad-session', inputSampleRate: 0 });
				}
				return new Response(null, { status: 204 });
			})
		);
		const session = createSession();

		await expect(session.connect()).rejects.toThrow('invalid audio input sample rate');

		expect(requests).toContainEqual({ url: '/sessions/bad-session', method: 'DELETE' });
	});

	it('rejects connection when the server fails before connecting', async () => {
		const requests: Array<{ url: string; method: string }> = [];
		const errors: string[] = [];
		vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost/playground' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
				const request = { url: String(input), method: init.method || 'GET' };
				requests.push(request);
				if (request.url === '/sessions' && request.method === 'POST') {
					return Response.json({ id: 'session-1', inputSampleRate: 24000 });
				}
				if (request.url === '/sessions/session-1' && request.method === 'GET') {
					return eventResponse(
						[
							{
								type: 'error',
								error: { provider: 'Test', message: 'Handshake failed', status: 401 }
							}
						],
						init.signal
					);
				}
				return new Response(null, { status: 204 });
			})
		);
		const session = createSession();
		session.subscribe((event) => collectError(event, errors));

		await expect(session.connect()).rejects.toThrow('Test: (HTTP 401) Handshake failed');

		expect(errors).toEqual(['Test: (HTTP 401) Handshake failed']);
		expect(requests).toContainEqual({ url: '/sessions/session-1', method: 'DELETE' });
	});

	it('can close while the start request is pending', async () => {
		vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost/playground' });
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: string | URL | Request, init: RequestInit = {}) =>
					new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener(
							'abort',
							() => reject(new DOMException('Start request aborted', 'AbortError')),
							{ once: true }
						);
					})
			)
		);
		const session = createSession();

		const connection = session.connect();
		await session.close();

		await expect(connection).rejects.toThrow('Test session is closed');
	});
});

function createSession(): RemoteAudioSession<{ provider: string }> {
	return new RemoteAudioSession({
		basePath: '/sessions',
		config: { provider: 'test' },
		sessionName: 'Test',
		defaultInputSampleRate: 24000
	});
}

function eventResponse(
	events: Parameters<typeof encodeRealtimeEvent>[0][],
	signal?: AbortSignal | null
): Response {
	let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			eventController = controller;
			for (const event of events) controller.enqueue(encodeRealtimeEvent(event));
		}
	});
	signal?.addEventListener(
		'abort',
		() => {
			try {
				eventController?.close();
			} catch {
				// The stream may already be cancelled by the reader.
			}
		},
		{ once: true }
	);
	return new Response(stream, {
		headers: { 'Content-Type': 'application/x-aiwrapper-realtime-events' }
	});
}

function collectError(event: RemoteAudioSessionEvent, errors: string[]): void {
	if (event.type === 'error') errors.push(event.error.message);
}
