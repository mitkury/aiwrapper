import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isProviderId } from '$lib/provider-config';
import type { RealtimeSessionConfig } from '$lib/realtime/realtime-session-protocol';
import { createRealtimeAgentSession } from '$lib/server/realtime-agent-sessions';
import { languageConfig } from '$lib/server/language';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const config = parseConfig(body);
		if (!languageConfig()[config.llm.provider].configured) {
			return json(
				{ error: `${config.llm.provider} is not configured in the server environment` },
				{ status: 503 }
			);
		}
		const record = await createRealtimeAgentSession(config);
		return json({ id: record.id, inputSampleRate: 24000 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not start realtime session';
		const status = error instanceof RequestValidationError ? 400 : 503;
		return json({ error: message }, { status });
	}
};

function parseConfig(value: unknown): RealtimeSessionConfig {
	if (!value || typeof value !== 'object')
		throw new RequestValidationError('Session config is required');
	const stt = Reflect.get(value, 'stt');
	const llm = Reflect.get(value, 'llm');
	const tts = Reflect.get(value, 'tts');
	if (!stt || typeof stt !== 'object') throw new RequestValidationError('STT config is required');
	if (!llm || typeof llm !== 'object') throw new RequestValidationError('LLM config is required');
	if (!tts || typeof tts !== 'object') throw new RequestValidationError('TTS config is required');

	const sttProvider = Reflect.get(stt, 'provider');
	if (sttProvider !== 'openai' && sttProvider !== 'deepgram' && sttProvider !== 'elevenlabs') {
		throw new RequestValidationError('Unsupported realtime transcription provider');
	}
	const llmProvider = Reflect.get(llm, 'provider');
	if (typeof llmProvider !== 'string' || !isProviderId(llmProvider)) {
		throw new RequestValidationError('Unsupported realtime language provider');
	}
	const ttsProvider = Reflect.get(tts, 'provider');
	if (ttsProvider !== 'openai' && ttsProvider !== 'elevenlabs') {
		throw new RequestValidationError('Unsupported realtime speech provider');
	}

	return {
		stt: { provider: sttProvider, model: shortString(stt, 'model') },
		llm: { provider: llmProvider, model: requiredShortString(llm, 'model') },
		tts: {
			provider: ttsProvider,
			model: shortString(tts, 'model'),
			voice: shortString(tts, 'voice')
		}
	};
}

function shortString(value: object, key: string): string {
	const item = Reflect.get(value, key);
	if (item === undefined || item === null) return '';
	if (typeof item !== 'string') throw new RequestValidationError(`${key} must be a string`);
	const normalized = item.trim();
	if (normalized.length > 200) throw new RequestValidationError(`${key} is too long`);
	return normalized;
}

function requiredShortString(value: object, key: string): string {
	const result = shortString(value, key);
	if (!result) throw new RequestValidationError(`${key} is required`);
	return result;
}

class RequestValidationError extends Error {}
