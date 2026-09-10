import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { languageConfig } from '$lib/server/language';

export function GET() {
	const openaiConfigured = Boolean(env.OPENAI_API_KEY?.trim());
	const deepgramConfigured = Boolean(env.DEEPGRAM_API_KEY?.trim());
	const elevenLabsConfigured = Boolean(env.ELEVENLABS_API_KEY?.trim());
	const elevenLabsVoiceId = env.ELEVENLABS_VOICE_ID?.trim() ?? '';
	return json({
		// Availability is shared by the Voice and Realtime pages.
		openai: openaiConfigured,
		elevenlabs: elevenLabsConfigured,
		elevenLabsVoiceId,
		openaiVoice: env.OPENAI_TTS_VOICE?.trim() || 'coral',
		llm: languageConfig(),
		stt: {
			openai: {
				configured: openaiConfigured,
				model: env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-mini-transcribe'
			},
			deepgram: {
				configured: deepgramConfigured,
				model: env.DEEPGRAM_FLUX_MODEL?.trim() || 'flux-general-en'
			},
			elevenlabs: {
				configured: elevenLabsConfigured,
				model: env.ELEVENLABS_STT_MODEL?.trim() || 'scribe_v2_realtime'
			}
		},
		tts: {
			openai: {
				configured: openaiConfigured,
				model: env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts',
				voice: env.OPENAI_TTS_VOICE?.trim() || 'coral'
			},
			elevenlabs: {
				configured: elevenLabsConfigured,
				model: env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5',
				voice: elevenLabsVoiceId
			}
		}
	});
}
