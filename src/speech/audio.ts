import type { PcmAudioFormat, PcmAudioFrame } from "./types.js";

export function assertPcmFrame(frame: PcmAudioFrame): void {
  if (frame.encoding !== "pcm_s16le") {
    throw new Error(`Unsupported PCM encoding: ${String(frame.encoding)}`);
  }
  if (frame.channels !== 1) {
    throw new Error("Speech providers currently accept mono PCM only");
  }
  if (!Number.isInteger(frame.sampleRate) || frame.sampleRate <= 0) {
    throw new RangeError("PCM sampleRate must be a positive integer");
  }
  if (!(frame.samples instanceof Int16Array)) {
    throw new TypeError("PCM samples must be an Int16Array");
  }
}

export function encodeMonoPcmAsWav(
  chunks: readonly Int16Array[],
  sampleRate: number,
): Blob {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const dataBytes = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return new Blob([bytes], { type: "audio/wav" });
}

export async function* responsePcmFrames(
  response: Response,
  format: PcmAudioFormat,
  signal?: AbortSignal,
): AsyncIterable<PcmAudioFrame> {
  throwIfAborted(signal);
  if (!response.body) {
    throw new Error("Speech provider returned no audio response body");
  }

  const reader = response.body.getReader();
  let carry: number | undefined;
  let completed = false;
  const onAbort = () => {
    void reader.cancel(createAbortError()).catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (!value || value.byteLength === 0) continue;

      const byteLength = value.byteLength + (carry === undefined ? 0 : 1);
      const usableBytes = byteLength - (byteLength % 2);
      const samples = new Int16Array(usableBytes / 2);
      let sourceIndex = 0;
      let sampleIndex = 0;

      if (carry !== undefined && usableBytes > 0) {
        samples[sampleIndex++] = toSigned16(carry, value[sourceIndex++]);
        carry = undefined;
      }

      while (sampleIndex < samples.length) {
        samples[sampleIndex++] = toSigned16(
          value[sourceIndex++],
          value[sourceIndex++],
        );
      }

      if (sourceIndex < value.byteLength) {
        carry = value[sourceIndex];
      }

      if (samples.length > 0) {
        yield { ...format, samples };
      }
    }

    throwIfAborted(signal);
    if (carry !== undefined) {
      throw new Error("Speech provider returned an incomplete PCM sample");
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

export function linkAbortSignal(
  source: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!source) return () => undefined;
  if (source.aborted) {
    controller.abort(source.reason);
    return () => undefined;
  }
  const onAbort = () => controller.abort(source.reason);
  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

export function encodePcmAsBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    result += alphabet[(value >> 18) & 63];
    result += alphabet[(value >> 12) & 63];
    result += hasSecond ? alphabet[(value >> 6) & 63] : "=";
    result += hasThird ? alphabet[value & 63] : "=";
  }

  return result;
}

export function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, "");
  if (!normalized) return new Uint8Array();
  if (normalized.length % 4 !== 0) {
    throw new Error("Invalid base64 audio payload");
  }

  const decoded = atob(normalized);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function decodeBase64Pcm(
  value: string,
  providerName: string,
): Int16Array {
  const bytes = decodeBase64(value);
  if (bytes.byteLength % 2 !== 0) {
    throw new Error(`${providerName} returned an incomplete PCM sample`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Int16Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}

function toSigned16(low: number, high: number): number {
  const unsigned = low | (high << 8);
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    target[offset + i] = text.charCodeAt(i);
  }
}
