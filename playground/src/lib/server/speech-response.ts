import { json } from '@sveltejs/kit';
import type { PcmAudioFormat, PcmAudioFrame } from 'aiwrapper/speech';

export async function pcmStreamResponse(
	frames: AsyncIterable<PcmAudioFrame>,
	format: PcmAudioFormat
): Promise<Response> {
	const iterator = frames[Symbol.asyncIterator]();
	const first = await iterator.next();
	if (first.done) throw new Error('Speech provider returned no audio frames');
	let pending: PcmAudioFrame | undefined = first.value;
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const current = pending ? { done: false as const, value: pending } : await iterator.next();
				pending = undefined;
				if (current.done) {
					controller.close();
					return;
				}
				if (
					current.value.encoding !== format.encoding ||
					current.value.channels !== format.channels ||
					current.value.sampleRate !== format.sampleRate
				) {
					throw new Error('Speech provider changed PCM format while streaming');
				}
				controller.enqueue(pcmFrameBytes(current.value));
			} catch (error) {
				await iterator.return?.();
				controller.error(error);
			}
		},
		async cancel() {
			await iterator.return?.();
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'audio/pcm',
			'X-Audio-Encoding': format.encoding,
			'X-Audio-Channels': String(format.channels),
			'X-Audio-Sample-Rate': String(format.sampleRate)
		}
	});
}

function pcmFrameBytes(frame: PcmAudioFrame): Uint8Array {
	const bytes = new Uint8Array(frame.samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < frame.samples.length; index++) {
		view.setInt16(index * 2, frame.samples[index], true);
	}
	return bytes;
}

export function speechError(error: unknown): Response {
	console.error('Speech playground request failed', error);
	return json(
		{ error: error instanceof Error ? error.message : 'Speech request failed' },
		{ status: 500 }
	);
}
