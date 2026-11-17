import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { isProviderId } from '$lib/provider-config';
import { languageConfig } from './language';

type Session = { child: ChildProcessWithoutNullStreams; stop: () => void };
const sessions = new Map<string, Session>();
export function cascadeConfig() {
	return {
		language: languageConfig(),
		deepgram: Boolean(env.DEEPGRAM_API_KEY),
		openai: Boolean(env.OPENAI_API_KEY),
		elevenlabs: Boolean(env.ELEVENLABS_API_KEY),
		voice: env.ELEVENLABS_VOICE_ID || '',
		live: {
			openai: {
				model: env.OPENAI_SPEECH_TO_SPEECH_MODEL || 'gpt-realtime-2.1',
				voice: env.OPENAI_SPEECH_TO_SPEECH_VOICE || 'marin'
			},
			google: {
				model: env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
				voice: env.GEMINI_LIVE_VOICE || 'Kore'
			}
		}
	};
}
export function startCascade(value: unknown, signal: AbortSignal): Response {
	if (!value || typeof value !== 'object') throw new Error('Session configuration required');
	const v = value as Record<string, unknown>;
	if (typeof v.offline !== 'boolean' || typeof v.provider !== 'string' || !isProviderId(v.provider))
		throw new Error('Invalid runtime or language provider');
	if (v.cameraContext !== undefined && !['latest', 'recent'].includes(String(v.cameraContext)))
		throw new Error('Invalid camera context policy');
	if (v.microphone !== undefined && typeof v.microphone !== 'boolean')
		throw new Error('Invalid microphone setting');
	for (const key of ['model', 'sttModel', 'ttsModel', 'voice']) {
		if (typeof v[key] !== 'string' || (v[key] as string).length > 200)
			throw new Error(`Invalid ${key}`);
	}
	if (v.tts !== 'openai' && v.tts !== 'elevenlabs') throw new Error('Invalid speech provider');
	if (v.live !== undefined && typeof v.live !== 'boolean') throw new Error('Invalid live mode');
	if (v.live && (v.offline || !['openai', 'google'].includes(v.provider)))
		throw new Error('Rust live voice requires OpenAI or Google');
	if (!v.offline) {
		if (!languageConfig()[v.provider].configured)
			throw new Error(`${v.provider} key is not configured`);
		if (!v.live && v.microphone && !env.DEEPGRAM_API_KEY)
			throw new Error('DEEPGRAM_API_KEY is not configured');
		if (!v.live && v.tts === 'openai' && !env.OPENAI_API_KEY)
			throw new Error('OPENAI_API_KEY is not configured');
		if (!v.live && v.tts === 'elevenlabs' && !env.ELEVENLABS_API_KEY)
			throw new Error('ELEVENLABS_API_KEY is not configured');
		if (!v.live && v.tts === 'elevenlabs' && !v.voice && !env.ELEVENLABS_VOICE_ID)
			throw new Error('Choose an ElevenLabs voice ID');
	}
	if (sessions.size >= 8) throw new Error('Too many sessions; disconnect an existing session');
	const id = crypto.randomUUID();
	const child = spawn(
		env.AIWRAPPER_CASCADE_BINARY ||
			resolve(
				process.cwd(),
				'../target/debug/examples/cascade' + (process.platform === 'win32' ? '.exe' : '')
			),
		[],
		{ env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }
	);
	const encoder = new TextEncoder();
	let finished = false;
	let controller: ReadableStreamDefaultController<Uint8Array>;
	const stop = () => {
		if (finished) return;
		finished = true;
		clearTimeout(lifetime);
		signal.removeEventListener('abort', stop);
		sessions.delete(id);
		child.kill();
		try {
			controller.close();
		} catch {
			/* Already cancelled by the browser. */
		}
	};
	const lifetime = setTimeout(stop, 30 * 60_000);
	lifetime.unref();
	child.stderr.resume();
	const stream = new ReadableStream<Uint8Array>(
		{
			start(c) {
				controller = c;
				child.stdout.on('data', (bytes: Buffer) => {
					if (finished) return;
					controller.enqueue(new Uint8Array(bytes));
					if ((controller.desiredSize ?? 0) <= 0) child.stdout.pause();
				});
				child.on('error', () => {
					if (!finished)
						controller.enqueue(
							encoder.encode(
								JSON.stringify({
									type: 'error',
									message: 'Rust cascade host could not start. Run npm run sandbox:native.'
								}) + '\n'
							)
						);
					stop();
				});
				child.on('close', stop);
				child.stdin.on('error', stop);
				signal.addEventListener('abort', stop, { once: true });
				sessions.set(id, { child, stop });
				if (signal.aborted) stop();
				else child.stdin.write(JSON.stringify(v) + '\n');
			},
			pull() {
				child.stdout.resume();
			},
			cancel() {
				stop();
			}
		},
		{ highWaterMark: 256 * 1024, size: (bytes) => bytes.byteLength }
	);
	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Cache-Control': 'no-store',
			'X-AIWrapper-Runtime': 'rust',
			'X-Session-Id': id
		}
	});
}
export async function cascadeCommand(id: string, value: unknown): Promise<void> {
	const record = sessions.get(id);
	if (!record) throw new Error('Session is closed');
	if (
		!value ||
		typeof value !== 'object' ||
		!['text', 'audio', 'image', 'interrupt', 'played', 'end-audio', 'close'].includes(
			String(Reflect.get(value, 'type'))
		)
	)
		throw new Error('Invalid session command');
	const line = JSON.stringify(value) + '\n';
	if (Buffer.byteLength(line) > 3 * 1024 * 1024) throw new Error('Command exceeds 3 MiB');
	if (record.child.stdin.writableLength > 128 * 1024) {
		record.stop();
		throw new Error('Input queue overflow; session stopped');
	}
	await new Promise<void>((resolve, reject) =>
		record.child.stdin.write(line, (error) => (error ? reject(error) : resolve()))
	);
}
export function stopCascade(id: string) {
	sessions.get(id)?.stop();
}
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		for (const session of sessions.values()) session.stop();
	});
