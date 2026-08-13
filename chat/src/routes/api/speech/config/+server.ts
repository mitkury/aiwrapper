import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';

export function GET() {
	return json({
		openai: Boolean(env.OPENAI_API_KEY),
		elevenlabs: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID),
		elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID ?? ''
	});
}
