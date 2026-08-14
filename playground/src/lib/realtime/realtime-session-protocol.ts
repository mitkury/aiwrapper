import type { PcmAudioFrame } from 'aiwrapper/speech';
import type { ProviderId } from '$lib/provider-config';

export type RealtimeSessionConfig = {
	stt: { provider: 'openai' | 'deepgram' | 'elevenlabs'; model: string };
	llm: { provider: ProviderId; model: string };
	tts: { provider: 'openai' | 'elevenlabs'; model: string; voice: string };
};

export type RealtimeServerError = {
	message: string;
	provider?: string;
	status?: number;
	code?: string;
	requestId?: string;
};

export type RealtimeServerEvent =
	| { type: 'connected' }
	| { type: 'heartbeat' }
	| { type: 'speech'; speaker: 'user' | 'assistant'; active: boolean }
	| {
			type: 'transcript';
			speaker: 'user' | 'assistant';
			text: string;
			final: boolean;
	  }
	| { type: 'interrupted'; reason: 'user_speech' | 'new_turn' | 'manual' | 'closed' }
	| {
			type: 'latency';
			stage:
				| 'stt_final'
				| 'input_ready'
				| 'llm_first_token'
				| 'tts_input'
				| 'tts_first_audio'
				| 'turn_complete';
			milliseconds: number;
	  }
	| { type: 'turn_complete' }
	| { type: 'error'; error: RealtimeServerError };

export type RealtimeServerPacket =
	| { type: 'event'; event: RealtimeServerEvent }
	| { type: 'audio'; frame: PcmAudioFrame };

const headerBytes = 5;
const eventPacket = 0;
const audioPacket = 1;
const audioMetadataBytes = 5;
const maximumPacketBytes = 4 * 1024 * 1024;

export function encodeRealtimeEvent(event: RealtimeServerEvent): Uint8Array {
	return encodePacket(eventPacket, new TextEncoder().encode(JSON.stringify(event)));
}

export function encodeRealtimeAudio(frame: PcmAudioFrame): Uint8Array {
	if (frame.encoding !== 'pcm_s16le' || frame.channels !== 1) {
		throw new Error('Realtime playback requires mono signed 16-bit PCM');
	}
	if (!Number.isInteger(frame.sampleRate) || frame.sampleRate <= 0) {
		throw new Error('Realtime playback requires a valid PCM sample rate');
	}
	const payload = new Uint8Array(audioMetadataBytes + frame.samples.length * 2);
	const view = new DataView(payload.buffer);
	view.setUint32(0, frame.sampleRate, true);
	payload[4] = frame.channels;
	for (let index = 0; index < frame.samples.length; index++) {
		view.setInt16(audioMetadataBytes + index * 2, frame.samples[index], true);
	}
	return encodePacket(audioPacket, payload);
}

export class RealtimeEventDecoder {
	private buffered = new Uint8Array();

	push(chunk: Uint8Array): RealtimeServerPacket[] {
		if (chunk.length) {
			const combined = new Uint8Array(this.buffered.length + chunk.length);
			combined.set(this.buffered);
			combined.set(chunk, this.buffered.length);
			this.buffered = combined;
		}

		const packets: RealtimeServerPacket[] = [];
		let offset = 0;
		while (this.buffered.length - offset >= headerBytes) {
			const type = this.buffered[offset];
			const length = new DataView(
				this.buffered.buffer,
				this.buffered.byteOffset + offset + 1,
				4
			).getUint32(0, true);
			if (!length || length > maximumPacketBytes) {
				throw new Error('Realtime event packet has an invalid length');
			}
			if (this.buffered.length - offset < headerBytes + length) break;
			const payload = this.buffered.slice(offset + headerBytes, offset + headerBytes + length);
			packets.push(decodePacket(type, payload));
			offset += headerBytes + length;
		}
		this.buffered = this.buffered.slice(offset);
		return packets;
	}

	finish(): void {
		if (this.buffered.length)
			throw new Error('Realtime event stream ended with an incomplete packet');
	}
}

function encodePacket(type: number, payload: Uint8Array): Uint8Array {
	if (!payload.length || payload.length > maximumPacketBytes) {
		throw new Error('Realtime event packet has an invalid length');
	}
	const packet = new Uint8Array(headerBytes + payload.length);
	packet[0] = type;
	new DataView(packet.buffer).setUint32(1, payload.length, true);
	packet.set(payload, headerBytes);
	return packet;
}

function decodePacket(type: number, payload: Uint8Array): RealtimeServerPacket {
	if (type === eventPacket) {
		return {
			type: 'event',
			event: JSON.parse(new TextDecoder().decode(payload)) as RealtimeServerEvent
		};
	}
	if (type !== audioPacket) throw new Error(`Unknown realtime event packet type: ${type}`);
	if (payload.length <= audioMetadataBytes || (payload.length - audioMetadataBytes) % 2 !== 0) {
		throw new Error('Realtime audio packet has an invalid length');
	}
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const sampleRate = view.getUint32(0, true);
	const channels = payload[4];
	if (!sampleRate || channels !== 1) throw new Error('Realtime audio packet has invalid metadata');
	const samples = new Int16Array((payload.length - audioMetadataBytes) / 2);
	for (let index = 0; index < samples.length; index++) {
		samples[index] = view.getInt16(audioMetadataBytes + index * 2, true);
	}
	return {
		type: 'audio',
		frame: { encoding: 'pcm_s16le', channels: 1, sampleRate, samples }
	};
}
