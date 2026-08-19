import {
	HttpRequestError,
	RealtimeAgent,
	type AgentEvent,
	type LangMessages,
	type LangTool,
	type PcmAudioFrame,
	type RealtimeAgentEvent
} from 'aiwrapper';
import { getProviderConfig } from '$lib/provider-config';
import type {
	RealtimeServerError,
	RealtimeServerPacket,
	RealtimeSessionConfig
} from '$lib/realtime/realtime-session-protocol';
import { createRealtimeLanguageProvider } from './realtime-language';
import { createRealtimeSpeechToText, createRealtimeTextToSpeech } from './realtime-speech';

type RealtimeAgentRecord = {
	id: string;
	agent: RealtimeAgent;
	listeners: Set<(packet: RealtimeServerPacket) => void>;
	unsubscribe: () => void;
	lastAccessAt: number;
};

const records = new Map<string, RealtimeAgentRecord>();
const maximumIdleMs = 30 * 60 * 1000;

const tools: LangTool[] = [
	{
		name: 'get_current_time',
		description: 'Get the current local time when the user asks for it.',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		handler: () => ({ localTime: new Date().toString() })
	}
];

export async function createRealtimeAgentSession(
	config: RealtimeSessionConfig
): Promise<RealtimeAgentRecord> {
	removeExpiredSessions();
	const id = crypto.randomUUID();
	const listeners = new Set<(packet: RealtimeServerPacket) => void>();
	const agent = new RealtimeAgent(
		createRealtimeLanguageProvider(config.llm.provider, config.llm.model),
		{
			speechToText: createRealtimeSpeechToText(config.stt),
			textToSpeech: createRealtimeTextToSpeech(config.tts),
			instructions:
				'You are a concise realtime voice assistant. Reply in the language of the latest user utterance. Use the latest camera image when it helps answer the user. Prefer short spoken responses.',
			tools,
			textSegmenter: { maxBufferedCharacters: 48, minimumSegmentCharacters: 12 }
		}
	);
	const record: RealtimeAgentRecord = {
		id,
		agent,
		listeners,
		unsubscribe: () => {},
		lastAccessAt: Date.now()
	};
	const providerLabel = `${config.stt.provider} STT / ${getProviderConfig(config.llm.provider).label} LLM / ${config.tts.provider} TTS`;
	record.unsubscribe = agent.subscribe((event) =>
		broadcastAgentEvent(record, event, providerLabel)
	);
	try {
		await agent.connect();
		records.set(id, record);
		return record;
	} catch (error) {
		record.unsubscribe();
		await agent.close().catch(() => undefined);
		throw error;
	}
}

export function getRealtimeAgentSession(id: string): RealtimeAgentRecord | undefined {
	removeExpiredSessions();
	const record = records.get(id);
	if (record) record.lastAccessAt = Date.now();
	return record;
}

export function subscribeRealtimeAgentSession(
	record: RealtimeAgentRecord,
	listener: (packet: RealtimeServerPacket) => void
): () => void {
	record.lastAccessAt = Date.now();
	record.listeners.add(listener);
	listener({ type: 'event', event: { type: 'connected' } });
	return () => record.listeners.delete(listener);
}

export async function appendRealtimeAgentAudio(
	record: RealtimeAgentRecord,
	frame: PcmAudioFrame
): Promise<void> {
	record.lastAccessAt = Date.now();
	await record.agent.sendAudio(frame);
}

export function sendRealtimeAgentText(record: RealtimeAgentRecord, text: string): void {
	record.lastAccessAt = Date.now();
	void record.agent.sendText(text).catch(() => undefined);
}

export function setRealtimeAgentImage(
	record: RealtimeAgentRecord,
	image: { blob: Blob; mimeType: string }
): void {
	record.lastAccessAt = Date.now();
	record.agent.setImage({ kind: 'blob', blob: image.blob, mimeType: image.mimeType });
}

export async function closeRealtimeAgentSession(id: string): Promise<void> {
	const record = records.get(id);
	if (!record) return;
	records.delete(id);
	await closeRecord(record);
}

function broadcastAgentEvent(
	record: RealtimeAgentRecord,
	event: AgentEvent<LangMessages, RealtimeAgentEvent>,
	providerLabel: string
): void {
	record.lastAccessAt = Date.now();
	let packet: RealtimeServerPacket | undefined;
	if (event.type === 'audio') {
		packet = { type: 'audio', frame: event.frame };
	} else if (event.type === 'connected') {
		packet = { type: 'event', event: { type: 'connected' } };
	} else if (event.type === 'speech') {
		packet = {
			type: 'event',
			event: { type: 'speech', speaker: event.speaker, active: event.active }
		};
	} else if (event.type === 'transcript') {
		packet = {
			type: 'event',
			event: {
				type: 'transcript',
				speaker: event.speaker,
				text: event.text,
				final: event.final
			}
		};
	} else if (event.type === 'interrupted') {
		packet = { type: 'event', event: { type: 'interrupted', reason: event.reason } };
	} else if (event.type === 'latency') {
		packet = {
			type: 'event',
			event: {
				type: 'latency',
				stage: event.stage,
				milliseconds: event.milliseconds
			}
		};
	} else if (event.type === 'turn_complete') {
		packet = { type: 'event', event: { type: 'turn_complete' } };
	} else if (event.type === 'error') {
		packet = {
			type: 'event',
			event: { type: 'error', error: serializeProviderError(providerLabel, event.error) }
		};
	}
	if (!packet) return;
	for (const listener of [...record.listeners]) listener(packet);
}

function serializeProviderError(provider: string, error: unknown): RealtimeServerError {
	const normalized = error instanceof Error ? error : new Error(String(error));
	const httpError = error instanceof HttpRequestError ? error : undefined;
	const body = httpError?.body as
		{ error?: { code?: string; message?: string } | string; message?: string } | undefined;
	const nestedError = typeof body?.error === 'object' ? body.error : undefined;
	const responseRequestId =
		httpError?.response?.headers.get('x-request-id') ||
		httpError?.response?.headers.get('request-id') ||
		undefined;
	return {
		provider,
		message:
			nestedError?.message ||
			(typeof body?.error === 'string' ? body.error : undefined) ||
			body?.message ||
			readableMessage(normalized.message),
		...(httpError?.response ? { status: httpError.response.status } : {}),
		...(nestedError?.code ? { code: nestedError.code } : {}),
		...(responseRequestId ? { requestId: responseRequestId } : {})
	};
}

function readableMessage(message: string): string {
	try {
		const body = JSON.parse(message) as { error?: { message?: string } | string; message?: string };
		return (
			(typeof body.error === 'object' ? body.error?.message : body.error) || body.message || message
		);
	} catch {
		return message;
	}
}

async function closeRecord(record: RealtimeAgentRecord): Promise<void> {
	record.unsubscribe();
	record.listeners.clear();
	await record.agent.close().catch(() => undefined);
}

function removeExpiredSessions(): void {
	const cutoff = Date.now() - maximumIdleMs;
	for (const [id, record] of records) {
		if (record.lastAccessAt >= cutoff) continue;
		records.delete(id);
		void closeRecord(record);
	}
}
