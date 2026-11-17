import { json } from '@sveltejs/kit';
import { nativeProcess } from './native-process';

type Packet = {
	audio?: string;
	sampleRate?: number;
	text?: string;
	done?: boolean;
	error?: string;
};
async function* packets(body: unknown, signal: AbortSignal): AsyncGenerator<Packet> {
	const response = nativeProcess('speech', body, signal);
	const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
	let pending = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) throw new Error('Rust speech stream ended before completion');
			pending += value;
			let end: number;
			while ((end = pending.indexOf('\n')) !== -1) {
				const packet: Packet = JSON.parse(pending.slice(0, end));
				pending = pending.slice(end + 1);
				if (packet.error) throw new Error(packet.error);
				yield packet;
				if (packet.done) return;
			}
			if (pending.length > 1024 * 1024) throw new Error('Rust speech packet exceeded 1 MiB');
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
export async function nativeTranscribe(
	audio: ArrayBuffer,
	sampleRate: number,
	signal: AbortSignal
) {
	for await (const packet of packets(
		{ operation: 'transcribe', audio: Buffer.from(audio).toString('base64'), sampleRate },
		signal
	)) {
		if (packet.done && typeof packet.text === 'string')
			return json({ text: packet.text }, { headers: { 'X-AIWrapper-Runtime': 'rust' } });
	}
	throw new Error('Rust transcription returned no text');
}
export async function nativeSpeak(
	body: { provider: string; text: string; model: string; voice: string },
	signal: AbortSignal
) {
	const cancellation = new AbortController();
	const iterator = packets(
		{ operation: 'speak', ...body },
		AbortSignal.any([signal, cancellation.signal])
	);
	let current = await iterator.next();
	if (current.done || !current.value.audio) {
		await iterator.return(undefined);
		throw new Error('Speech provider returned no audio');
	}
	const rate = current.value.sampleRate;
	return new Response(
		new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					if (current.done || current.value.done) {
						await iterator.return(undefined);
						controller.close();
						return;
					}
					const packet = current.value;
					if (!packet.audio || packet.sampleRate !== rate)
						throw new Error('Invalid or changed speech PCM format');
					controller.enqueue(Buffer.from(packet.audio, 'base64'));
					current = await iterator.next();
				} catch (error) {
					await iterator.return(undefined);
					controller.error(error);
				}
			},
			async cancel() {
				cancellation.abort();
				await iterator.return(undefined);
			}
		}),
		{
			headers: {
				'Content-Type': 'audio/pcm',
				'X-Audio-Encoding': 'pcm_s16le',
				'X-Audio-Channels': '1',
				'X-Audio-Sample-Rate': String(rate),
				'X-AIWrapper-Runtime': 'rust'
			}
		}
	);
}
export function speechError(error: unknown): Response {
	return json(
		{ error: error instanceof Error ? error.message : 'Speech request failed' },
		{ status: 500 }
	);
}
