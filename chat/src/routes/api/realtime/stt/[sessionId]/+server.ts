import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	appendRealtimeSttAudio,
	closeRealtimeSttSession,
	getRealtimeSttSession,
	subscribeRealtimeSttSession
} from '$lib/server/realtime-stt-sessions';

export const GET: RequestHandler = ({ params, request }) => {
	const record = getRealtimeSttSession(params.sessionId);
	if (!record) return json({ error: 'Unknown realtime transcription session' }, { status: 404 });

	const encoder = new TextEncoder();
	let unsubscribe: () => void = () => {};
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let close: () => void = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			unsubscribe = subscribeRealtimeSttSession(record, (event) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
			});
			heartbeat = setInterval(() => {
				controller.enqueue(encoder.encode(': heartbeat\n\n'));
			}, 15_000);
			close = () => {
				if (heartbeat) clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// The client may already have closed the stream.
				}
			};
			request.signal.addEventListener('abort', close, { once: true });
		},
		cancel() {
			close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};

export const POST: RequestHandler = async ({ params, request }) => {
	const record = getRealtimeSttSession(params.sessionId);
	if (!record) return json({ error: 'Unknown realtime transcription session' }, { status: 404 });

	try {
		const sampleRate = Number(request.headers.get('x-audio-sample-rate'));
		if (sampleRate !== 24000) {
			return json({ error: 'Realtime transcription requires 24000 Hz PCM' }, { status: 400 });
		}
		const bytes = await request.arrayBuffer();
		if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
			return json({ error: 'Audio must be non-empty signed 16-bit PCM' }, { status: 400 });
		}
		const source = new DataView(bytes);
		const samples = new Int16Array(bytes.byteLength / 2);
		for (let index = 0; index < samples.length; index++) {
			samples[index] = source.getInt16(index * 2, true);
		}
		await appendRealtimeSttAudio(record, {
			encoding: 'pcm_s16le',
			channels: 1,
			sampleRate,
			samples
		});
		return new Response(null, { status: 204 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not append audio' },
			{ status: 500 }
		);
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	await closeRealtimeSttSession(params.sessionId);
	return new Response(null, { status: 204 });
};
