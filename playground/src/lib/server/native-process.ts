import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from '$env/dynamic/private';

/** Development adapter: the reusable Rust crate does not start a server. */
export function nativeProcess(
	example: 'sandbox' | 'speech',
	body: unknown,
	signal: AbortSignal
): Response {
	const executable =
		(example === 'sandbox' ? env.AIWRAPPER_NATIVE_BINARY : env.AIWRAPPER_SPEECH_BINARY) ||
		resolve(
			process.cwd(),
			'../target/debug/examples',
			example + (process.platform === 'win32' ? '.exe' : '')
		);
	const child = spawn(executable, [], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, ...env }
	});
	let finished = false;
	let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const stop = (error?: Error) => {
		if (finished) return;
		finished = true;
		signal.removeEventListener('abort', abort);
		child.kill();
		if (error) streamController?.error(error);
	};
	const abort = () => stop(new DOMException('Native request aborted', 'AbortError'));
	// Errors are sent as JSON on stdout by the adapter. Drain stderr without
	// exposing process environment or provider diagnostic output to the browser.
	child.stderr.resume();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			streamController = controller;
			signal.addEventListener('abort', abort, { once: true });
			const close = (error?: string) => {
				if (finished) return;
				finished = true;
				signal.removeEventListener('abort', abort);
				if (error) controller.enqueue(encoder.encode(JSON.stringify({ done: true, error }) + '\n'));
				controller.close();
			};
			child.stdout.on('data', (data: Buffer) => {
				if (!finished) {
					controller.enqueue(new Uint8Array(data));
					if ((controller.desiredSize ?? 0) <= 0) child.stdout.pause();
				}
			});
			child.on('error', () => close('Native runtime could not start. Run npm run native:build.'));
			child.on('close', (code) =>
				close(code === 0 ? undefined : 'Native runtime exited unsuccessfully.')
			);
			child.stdin.on('error', () => {
				/* Process exit is handled above. */
			});
			if (signal.aborted) abort();
			else child.stdin.end(JSON.stringify(body));
		},
		pull() {
			child.stdout.resume();
		},
		cancel() {
			stop();
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Cache-Control': 'no-store',
			'X-AIWrapper-Runtime': 'rust'
		}
	});
}
