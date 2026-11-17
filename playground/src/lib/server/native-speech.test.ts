import { afterEach, expect, it, vi } from 'vitest';
import { nativeProcess } from './native-process';
import { nativeSpeak, nativeTranscribe } from './native-speech';
vi.mock('./native-process', () => ({ nativeProcess: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const body = { provider: 'openai', model: 'fixture', voice: 'voice', text: 'Hello' };
function output(...packets: unknown[]) {
	vi.mocked(nativeProcess).mockReturnValue(
		new Response(packets.map((p) => JSON.stringify(p)).join('\n') + '\n')
	);
}
it('passes recorded PCM to Rust and returns the transcription', async () => {
	output({ text: 'Hello', done: true });
	const response = await nativeTranscribe(
		new Uint8Array([0, 1]).buffer,
		24000,
		new AbortController().signal
	);
	expect(await response.json()).toEqual({ text: 'Hello' });
	expect(nativeProcess).toHaveBeenCalledWith(
		'speech',
		{ operation: 'transcribe', audio: 'AAE=', sampleRate: 24000 },
		expect.any(AbortSignal)
	);
});
it('streams Rust PCM frames with the reported sample rate', async () => {
	output(
		{ audio: 'AAE=', sampleRate: 24000 },
		{ audio: 'AgM=', sampleRate: 24000 },
		{ done: true }
	);
	const response = await nativeSpeak(body, new AbortController().signal);
	expect(response.headers.get('x-aiwrapper-runtime')).toBe('rust');
	expect(response.headers.get('x-audio-sample-rate')).toBe('24000');
	expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 1, 2, 3]);
});
it('preserves provider errors before and during speech', async () => {
	output({ error: 'HTTP 429: fixture limit', done: true });
	await expect(nativeSpeak(body, new AbortController().signal)).rejects.toThrow('HTTP 429');
	output({ audio: 'AAE=', sampleRate: 24000 }, { error: 'stream failed', done: true });
	const response = await nativeSpeak(body, new AbortController().signal);
	await expect(response.arrayBuffer()).rejects.toThrow('stream failed');
});
it('aborts the native process even when cancellation arrives during a pending read', async () => {
	let signal: AbortSignal | undefined;
	vi.mocked(nativeProcess).mockImplementation((_example, _body, abort) => {
		signal = abort;
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"audio":"AAE=","sampleRate":24000}\n'));
					abort.addEventListener(
						'abort',
						() => controller.error(new DOMException('Aborted', 'AbortError')),
						{ once: true }
					);
				}
			})
		);
	});
	const response = await nativeSpeak(body, new AbortController().signal);
	await response.body!.cancel();
	expect(signal?.aborted).toBe(true);
});
