const headerBytes = 4;
const maximumAudioBytes = 1024 * 1024;

export function encodeAudioPacket(bytes: Uint8Array): Uint8Array {
	if (!bytes.length || bytes.length % 2 !== 0) {
		throw new Error('Audio packet must contain signed 16-bit PCM');
	}
	if (bytes.length > maximumAudioBytes) throw new Error('Audio packet is too large');
	const packet = new Uint8Array(headerBytes + bytes.length);
	new DataView(packet.buffer).setUint32(0, bytes.length, true);
	packet.set(bytes, headerBytes);
	return packet;
}

export class AudioUploadDecoder {
	private buffered = new Uint8Array();

	push(chunk: Uint8Array): Uint8Array[] {
		if (chunk.length) {
			const combined = new Uint8Array(this.buffered.length + chunk.length);
			combined.set(this.buffered);
			combined.set(chunk, this.buffered.length);
			this.buffered = combined;
		}

		const packets: Uint8Array[] = [];
		let offset = 0;
		while (this.buffered.length - offset >= headerBytes) {
			const length = new DataView(
				this.buffered.buffer,
				this.buffered.byteOffset + offset,
				4
			).getUint32(0, true);
			if (!length || length % 2 !== 0 || length > maximumAudioBytes) {
				throw new Error('Audio upload packet has an invalid length');
			}
			if (this.buffered.length - offset < headerBytes + length) break;
			packets.push(this.buffered.slice(offset + headerBytes, offset + headerBytes + length));
			offset += headerBytes + length;
		}
		this.buffered = this.buffered.slice(offset);
		return packets;
	}

	finish(): void {
		if (this.buffered.length) throw new Error('Audio upload ended with an incomplete packet');
	}
}
