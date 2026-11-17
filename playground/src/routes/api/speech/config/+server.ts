import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
export function GET() {
	return json({
		openai: Boolean(env.OPENAI_API_KEY?.trim()),
		elevenlabs: Boolean(env.ELEVENLABS_API_KEY?.trim()),
		elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID?.trim() || '',
		openaiVoice: env.OPENAI_TTS_VOICE?.trim() || 'coral'
	});
}
