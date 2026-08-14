import { env } from '$env/dynamic/private';
import {
	SpeechToText,
	type PcmAudioFrame,
	type SpeechToTextSession,
	type TranscriptionResult
} from 'aiwrapper/unstable/speech';

type ClientEvent =
	| { type: 'ready' }
	| { type: 'transcript'; final: boolean; text: string; languages?: string[] }
	| { type: 'speech'; active: boolean; audioOffsetMs?: number };

type RealtimeSttRecord = {
	id: string;
	session: SpeechToTextSession;
	listeners: Set<(event: ClientEvent) => void>;
	lastAccessAt: number;
};

const records = new Map<string, RealtimeSttRecord>();
const maximumIdleMs = 30 * 60 * 1000;

export async function createRealtimeSttSession(): Promise<RealtimeSttRecord> {
	if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
	removeExpiredSessions();

	const id = crypto.randomUUID();
	const listeners = new Set<(event: ClientEvent) => void>();
	const broadcast = (event: ClientEvent) => {
		for (const listener of [...listeners]) listener(event);
	};
	const provider = SpeechToText.openaiRealtime({
		apiKey: env.OPENAI_API_KEY,
		model: env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || undefined,
		language: env.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE || undefined,
		turnDetection: {
			type: 'server_vad',
			silence_duration_ms: 400,
			prefix_padding_ms: 300
		},
		noiseReduction: { type: 'near_field' }
	});
	const session = await provider.createSession({
		onTranscript: (event) => {
			broadcast({
				type: 'transcript',
				final: event.type === 'final',
				text: event.text,
				...(event.type === 'final' && event.languages ? { languages: event.languages } : {})
			});
		},
		onSpeechActivity: (event) => {
			broadcast({
				type: 'speech',
				active: event.type === 'start',
				...(event.audioOffsetMs === undefined ? {} : { audioOffsetMs: event.audioOffsetMs })
			});
		}
	});
	const record = { id, session, listeners, lastAccessAt: Date.now() };
	records.set(id, record);
	return record;
}

export function getRealtimeSttSession(id: string): RealtimeSttRecord | undefined {
	const record = records.get(id);
	if (record) record.lastAccessAt = Date.now();
	return record;
}

export async function appendRealtimeSttAudio(
	record: RealtimeSttRecord,
	frame: PcmAudioFrame
): Promise<void> {
	record.lastAccessAt = Date.now();
	await record.session.appendAudio(frame);
}

export async function commitRealtimeSttAudio(
	record: RealtimeSttRecord
): Promise<TranscriptionResult> {
	record.lastAccessAt = Date.now();
	return record.session.commit();
}

export function subscribeRealtimeSttSession(
	record: RealtimeSttRecord,
	listener: (event: ClientEvent) => void
): () => void {
	record.listeners.add(listener);
	listener({ type: 'ready' });
	return () => record.listeners.delete(listener);
}

export async function closeRealtimeSttSession(id: string): Promise<void> {
	const record = records.get(id);
	if (!record) return;
	records.delete(id);
	await record.session.close();
	record.listeners.clear();
}

function removeExpiredSessions(): void {
	const cutoff = Date.now() - maximumIdleMs;
	for (const [id, record] of records) {
		if (record.lastAccessAt >= cutoff) continue;
		records.delete(id);
		void record.session.close();
		record.listeners.clear();
	}
}
