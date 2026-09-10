import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { speechToSpeechConfig } from '$lib/server/speech-to-speech-sessions';

export const GET: RequestHandler = () => json(speechToSpeechConfig());
