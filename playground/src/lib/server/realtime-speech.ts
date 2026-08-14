import { env } from '$env/dynamic/private';
import { SpeechToText, TextToSpeech } from 'aiwrapper/speech';
import type { RealtimeSessionConfig } from '$lib/realtime/realtime-session-protocol';

export function createRealtimeSpeechToText(config: RealtimeSessionConfig['stt']) {
	if (config.provider === 'deepgram') {
		if (!env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY is not configured');
		return SpeechToText.deepgramFlux({
			apiKey: env.DEEPGRAM_API_KEY,
			model: config.model || env.DEEPGRAM_FLUX_MODEL || undefined,
			endOfTurnTimeoutMs: numberFromEnvironment('DEEPGRAM_FLUX_EOT_TIMEOUT_MS', 1000, 500)
		});
	}
	if (config.provider === 'elevenlabs') {
		if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not configured');
		return SpeechToText.elevenlabsRealtime({
			apiKey: env.ELEVENLABS_API_KEY,
			model: config.model || env.ELEVENLABS_STT_MODEL || undefined,
			commitStrategy: 'vad',
			vadSilenceThresholdSeconds: numberFromEnvironment('ELEVENLABS_STT_VAD_SILENCE_SECONDS', 0.35)
		});
	}
	if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
	return SpeechToText.openaiRealtime({
		apiKey: env.OPENAI_API_KEY,
		model: config.model || env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || undefined,
		language: env.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE || undefined,
		turnDetection: {
			type: 'server_vad',
			silence_duration_ms: 300,
			prefix_padding_ms: 300
		},
		noiseReduction: { type: 'near_field' }
	});
}

export function createRealtimeTextToSpeech(config: RealtimeSessionConfig['tts']) {
	if (config.provider === 'elevenlabs') {
		if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not configured');
		const voiceId = config.voice || env.ELEVENLABS_VOICE_ID;
		if (!voiceId) throw new Error('An ElevenLabs voice ID is required');
		return TextToSpeech.elevenlabs({
			apiKey: env.ELEVENLABS_API_KEY,
			voiceId,
			model: config.model || env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5',
			sampleRate: 24000
		});
	}
	if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
	return TextToSpeech.openai({
		apiKey: env.OPENAI_API_KEY,
		model: config.model || env.OPENAI_TTS_MODEL || undefined,
		voice: config.voice || env.OPENAI_TTS_VOICE || undefined
	});
}

function numberFromEnvironment(name: string, fallback: number, minimum = 0): number {
	const raw = env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < minimum) {
		throw new Error(`${name} must be a number greater than or equal to ${minimum}`);
	}
	return value;
}
