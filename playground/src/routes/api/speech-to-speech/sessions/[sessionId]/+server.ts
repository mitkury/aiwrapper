import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AudioUploadDecoder } from '$lib/realtime/audio-upload-protocol';
import { pcmBytesToSamples } from '$lib/realtime/pcm';
import { encodeRealtimeAudio, encodeRealtimeEvent } from '$lib/realtime/realtime-session-protocol';
import {
	appendSpeechToSpeechAudio,
	closeSpeechToSpeechSession,
	getSpeechToSpeechSession,
	speechToSpeechError,
	subscribeSpeechToSpeechSession,
	type SpeechToSpeechRecord
} from '$lib/server/speech-to-speech-sessions';

export const GET: RequestHandler = ({ params, request }) => {
	const record = getSpeechToSpeechSession(params.sessionId);
	if (!record) return json({ error: 'Unknown speech-to-speech session' }, { status: 404 });

	let unsubscribe = () => {};
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let close = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const send = (bytes: Uint8Array) => {
				if (closed) return;
				try {
					controller.enqueue(bytes);
				} catch {
					close();
				}
			};
			unsubscribe = subscribeSpeechToSpeechSession(record, (packet) => {
				send(
					packet.type === 'audio'
						? encodeRealtimeAudio(packet.frame)
						: encodeRealtimeEvent(packet.event)
				);
			});
			heartbeat = setInterval(() => send(encodeRealtimeEvent({ type: 'heartbeat' })), 15_000);
			close = () => {
				if (closed) return;
				closed = true;
				if (heartbeat) clearInterval(heartbeat);
				unsubscribe();
				void closeSpeechToSpeechSession(params.sessionId);
				try {
					controller.close();
				} catch {
					// The browser may have already cancelled the response.
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
			'Content-Type': 'application/x-aiwrapper-realtime-events',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};

export const POST: RequestHandler = async ({ params, request }) => {
	const record = getSpeechToSpeechSession(params.sessionId);
	if (!record) return json({ error: 'Unknown speech-to-speech session' }, { status: 404 });

	try {
		const contentType = request.headers.get('content-type')?.split(';', 1)[0];
		if (contentType === 'audio/pcm') {
			const sampleRate = Number(request.headers.get('x-audio-sample-rate'));
			if (sampleRate !== record.provider.inputFormat.sampleRate) {
				return json(
					{
						error: `Speech-to-speech input requires ${record.provider.inputFormat.sampleRate} Hz PCM`
					},
					{ status: 400 }
				);
			}
			await appendPcm(record, new Uint8Array(await request.arrayBuffer()));
			return new Response(null, { status: 204 });
		}
		if (contentType !== 'application/x-aiwrapper-audio-stream') {
			return json({ error: 'Expected PCM audio or a framed audio stream' }, { status: 415 });
		}
		if (!request.body) return json({ error: 'Audio stream is missing' }, { status: 400 });

		const decoder = new AudioUploadDecoder();
		const reader = request.body.getReader();
		try {
			while (true) {
				const { value: chunk, done } = await reader.read();
				if (done) break;
				for (const bytes of decoder.push(chunk)) await appendPcm(record, bytes);
			}
		} finally {
			reader.releaseLock();
		}
		decoder.finish();
		return new Response(null, { status: 204 });
	} catch (error) {
		return json({ error: speechToSpeechError(record.providerId, error) }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	await closeSpeechToSpeechSession(params.sessionId);
	return new Response(null, { status: 204 });
};

async function appendPcm(record: SpeechToSpeechRecord, bytes: Uint8Array): Promise<void> {
	await appendSpeechToSpeechAudio(record, {
		encoding: 'pcm_s16le',
		channels: 1,
		sampleRate: record.provider.inputFormat.sampleRate,
		samples: pcmBytesToSamples(bytes)
	});
}
