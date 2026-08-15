import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type {
	SpeechToSpeechProviderId,
	SpeechToSpeechSessionConfig
} from '$lib/speech-to-speech/remote-speech-to-speech-session';
import {
	createSpeechToSpeechSession,
	speechToSpeechConfig
} from '$lib/server/speech-to-speech-sessions';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const config = parseConfig(await request.json());
		if (!speechToSpeechConfig()[config.provider].configured) {
			return json(
				{
					error: `${providerEnvironmentKey(config.provider)} is not configured`
				},
				{ status: 503 }
			);
		}
		const record = await createSpeechToSpeechSession(config);
		return json({ id: record.id, inputSampleRate: record.provider.inputFormat.sampleRate });
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : 'Could not start speech-to-speech session'
			},
			{ status: error instanceof RequestValidationError ? 400 : 503 }
		);
	}
};

function parseConfig(value: unknown): SpeechToSpeechSessionConfig {
	if (!value || typeof value !== 'object') {
		throw new RequestValidationError('Session config is required');
	}
	const rawProvider = Reflect.get(value, 'provider');
	if (
		rawProvider !== 'openai' &&
		rawProvider !== 'gemini' &&
		rawProvider !== 'xai' &&
		rawProvider !== 'azure' &&
		rawProvider !== 'nova'
	) {
		throw new RequestValidationError('Unsupported speech-to-speech provider');
	}
	const provider: SpeechToSpeechProviderId = rawProvider;
	return {
		provider,
		model: requiredShortString(value, 'model'),
		voice: requiredShortString(value, 'voice'),
		instructions: shortString(value, 'instructions', 4000)
	};
}

function providerEnvironmentKey(provider: SpeechToSpeechProviderId): string {
	if (provider === 'openai') return 'OPENAI_API_KEY';
	if (provider === 'gemini') return 'GOOGLE_API_KEY';
	if (provider === 'xai') return 'XAI_API_KEY';
	if (provider === 'azure') return 'AZURE_VOICE_LIVE_ENDPOINT and credentials';
	return 'AWS credentials';
}

function requiredShortString(value: object, key: string): string {
	const result = shortString(value, key);
	if (!result) throw new RequestValidationError(`${key} is required`);
	return result;
}

function shortString(value: object, key: string, maximumLength = 200): string {
	const item = Reflect.get(value, key);
	if (item === undefined || item === null) return '';
	if (typeof item !== 'string') throw new RequestValidationError(`${key} must be a string`);
	const normalized = item.trim();
	if (normalized.length > maximumLength) {
		throw new RequestValidationError(`${key} is too long`);
	}
	return normalized;
}

class RequestValidationError extends Error {}
