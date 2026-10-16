import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import type { ChatMessage } from '$lib/chat';
import type { ProviderId } from '$lib/provider-config';

/** Development adapter: the reusable Rust crate does not start a server. */
export function nativeChat(
	body: { provider: ProviderId; model: string; messages: ChatMessage[] },
	signal: AbortSignal
): Response {
	const executable =
		env.AIWRAPPER_NATIVE_BINARY ||
		resolve(
			process.cwd(),
			'../target/debug/examples',
			process.platform === 'win32' ? 'sandbox.exe' : 'sandbox'
		);
	const child = spawn(executable, [], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, ...env }
	});
	let finished = false;
	let cancelled = false;
	let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const stop = () => {
		if (finished) return;
		cancelled = true;
		finished = true;
		child.kill();
		streamController?.error(new DOMException('Native chat aborted', 'AbortError'));
	};
	// Errors are sent as JSON on stdout by the adapter. Drain stderr without
	// exposing process environment or provider diagnostic output to the browser.
	child.stderr.resume();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			streamController = controller;
			signal.addEventListener('abort', stop, { once: true });
			const close = (error?: string) => {
				if (finished) return;
				finished = true;
				signal.removeEventListener('abort', stop);
				if (!cancelled) {
					if (error)
						controller.enqueue(encoder.encode(JSON.stringify({ done: true, error }) + '\n'));
					controller.close();
				}
			};
			child.stdout.on('data', (data: Buffer) => {
				if (!cancelled && !finished) {
					controller.enqueue(new Uint8Array(data));
					if ((controller.desiredSize ?? 0) <= 0) child.stdout.pause();
				}
			});
			child.on('error', () => close('Native runtime could not start. Run npm run native:build.'));
			child.on('close', (code) =>
				close(code ? 'Native runtime exited unsuccessfully.' : undefined)
			);
			child.stdin.on('error', () => {
				/* Process exit is handled above. */
			});
			if (signal.aborted) stop();
			else child.stdin.end(JSON.stringify(body));
		},
		pull() {
			child.stdout.resume();
		},
		cancel() {
			cancelled = true;
			finished = true;
			child.kill();
			signal.removeEventListener('abort', stop);
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
