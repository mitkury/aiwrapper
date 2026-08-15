import { env } from '$env/dynamic/private';
import {
	SpeechToSpeech,
	type PcmAudioFrame,
	type SpeechToSpeechEvent,
	type SpeechToSpeechProvider,
	type SpeechToSpeechSession
} from 'aiwrapper/unstable/speech';
import type {
	SpeechToSpeechProviderId,
	SpeechToSpeechSessionConfig
} from '$lib/speech-to-speech/remote-speech-to-speech-session';
import type {
	RealtimeServerError,
	RealtimeServerPacket
} from '$lib/realtime/realtime-session-protocol';

export type SpeechToSpeechRecord = {
	id: string;
	providerId: SpeechToSpeechProviderId;
	provider: SpeechToSpeechProvider;
	session: SpeechToSpeechSession;
	listeners: Set<(packet: RealtimeServerPacket) => void>;
	pendingPackets: RealtimeServerPacket[];
	lastAccessAt: number;
};

const records = new Map<string, SpeechToSpeechRecord>();
const maximumIdleMs = 30 * 60 * 1000;

export function speechToSpeechConfig() {
	return {
		openai: {
			configured: Boolean(env.OPENAI_API_KEY?.trim()),
			model: env.OPENAI_SPEECH_TO_SPEECH_MODEL || 'gpt-realtime-2.1',
			voice: env.OPENAI_SPEECH_TO_SPEECH_VOICE || 'marin'
		},
		gemini: {
			configured: Boolean(env.GOOGLE_API_KEY?.trim()),
			model: env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
			voice: env.GEMINI_LIVE_VOICE || 'Kore'
		}
	};
}

export async function createSpeechToSpeechSession(
	config: SpeechToSpeechSessionConfig
): Promise<SpeechToSpeechRecord> {
	removeExpiredSessions();
	const provider = createProvider(config);
	const listeners = new Set<(packet: RealtimeServerPacket) => void>();
	const pendingEvents: SpeechToSpeechEvent[] = [];
	let record: SpeechToSpeechRecord | undefined;
	let session: SpeechToSpeechSession | undefined;
	try {
		session = await provider.createSession({
			instructions:
				config.instructions ||
				'You are a concise live voice assistant. Reply naturally and keep spoken answers brief.',
			onEvent: (event) => {
				if (record) broadcastEvent(record, event);
				else pendingEvents.push(event);
			}
		});
		record = {
			id: crypto.randomUUID(),
			providerId: config.provider,
			provider,
			session,
			listeners,
			pendingPackets: [],
			lastAccessAt: Date.now()
		};
		records.set(record.id, record);
		for (const event of pendingEvents) broadcastEvent(record, event);
		return record;
	} catch (error) {
		await session?.close().catch(() => undefined);
		throw error;
	}
}

export function getSpeechToSpeechSession(id: string): SpeechToSpeechRecord | undefined {
	removeExpiredSessions();
	const record = records.get(id);
	if (record) record.lastAccessAt = Date.now();
	return record;
}

export function subscribeSpeechToSpeechSession(
	record: SpeechToSpeechRecord,
	listener: (packet: RealtimeServerPacket) => void
): () => void {
	record.lastAccessAt = Date.now();
	record.listeners.add(listener);
	listener({ type: 'event', event: { type: 'connected' } });
	for (const packet of record.pendingPackets) listener(packet);
	record.pendingPackets.length = 0;
	return () => record.listeners.delete(listener);
}

export async function appendSpeechToSpeechAudio(
	record: SpeechToSpeechRecord,
	frame: PcmAudioFrame
): Promise<void> {
	record.lastAccessAt = Date.now();
	await record.session.appendAudio(frame);
}

export async function closeSpeechToSpeechSession(id: string): Promise<void> {
	const record = records.get(id);
	if (!record) return;
	records.delete(id);
	record.listeners.clear();
	await record.session.close().catch(() => undefined);
}

function createProvider(config: SpeechToSpeechSessionConfig): SpeechToSpeechProvider {
	if (config.provider === 'gemini') {
		if (!env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not configured');
		return SpeechToSpeech.geminiLive({
			apiKey: env.GOOGLE_API_KEY,
			model: config.model || env.GEMINI_LIVE_MODEL || undefined,
			voice: config.voice || env.GEMINI_LIVE_VOICE || undefined
		});
	}
	if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
	return SpeechToSpeech.openaiRealtime({
		apiKey: env.OPENAI_API_KEY,
		model: config.model || env.OPENAI_SPEECH_TO_SPEECH_MODEL || undefined,
		voice: config.voice || env.OPENAI_SPEECH_TO_SPEECH_VOICE || undefined
	});
}

function broadcastEvent(record: SpeechToSpeechRecord, event: SpeechToSpeechEvent): void {
	record.lastAccessAt = Date.now();
	let packet: RealtimeServerPacket;
	if (event.type === 'output-audio') {
		packet = { type: 'audio', frame: event.frame };
	} else if (event.type === 'input-transcript' || event.type === 'output-transcript') {
		packet = {
			type: 'event',
			event: {
				type: 'transcript',
				speaker: event.type === 'input-transcript' ? 'user' : 'assistant',
				text: event.transcript.text,
				final: event.transcript.type === 'final'
			}
		};
	} else if (event.type === 'response-start') {
		packet = {
			type: 'event',
			event: { type: 'speech', speaker: 'assistant', active: true }
		};
	} else if (event.type === 'response-end') {
		packet = { type: 'event', event: { type: 'turn_complete' } };
	} else if (event.type === 'error') {
		packet = {
			type: 'event',
			event: { type: 'error', error: speechToSpeechError(record.providerId, event.error) }
		};
	} else {
		packet = {
			type: 'event',
			event: { type: 'interrupted', reason: 'user_speech' }
		};
	}
	if (record.listeners.size === 0) {
		record.pendingPackets.push(packet);
		return;
	}
	for (const listener of [...record.listeners]) listener(packet);
}

export function speechToSpeechError(
	provider: SpeechToSpeechProviderId,
	error: unknown
): RealtimeServerError {
	return {
		provider: provider === 'openai' ? 'OpenAI Realtime' : 'Gemini Live',
		message: error instanceof Error ? error.message : String(error)
	};
}

function removeExpiredSessions(): void {
	const cutoff = Date.now() - maximumIdleMs;
	for (const [id, record] of records) {
		if (record.lastAccessAt >= cutoff) continue;
		records.delete(id);
		record.listeners.clear();
		void record.session.close().catch(() => undefined);
	}
}
