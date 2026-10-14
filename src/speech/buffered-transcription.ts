import {
  assertPcmFrame,
  encodeMonoPcmAsWav,
  linkAbortSignal,
  throwIfAborted,
} from "./audio.js";
import type {
  PcmAudioFrame,
  SpeechToTextSession,
  SpeechToTextSessionOptions,
  TranscriptionResult,
} from "./types.js";

/** Sends one recorded utterance and answers its transcript. */
export type TranscribeWav = (
  wav: Blob,
  signal: AbortSignal,
) => Promise<TranscriptionResult>;

/**
 * A session for file-style transcription: it buffers an utterance's PCM and
 * sends it as one WAV on commit() or finish().
 */
export class BufferedTranscriptionSession implements SpeechToTextSession {
  private readonly chunks: Int16Array[] = [];
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private sampleRate?: number;
  private audioBytes = 0;
  private state: "open" | "finishing" | "finished" | "closed" = "open";

  constructor(
    private readonly provider: { name: string; maxAudioBytes: number; transcribe: TranscribeWav },
    private readonly session: SpeechToTextSessionOptions,
  ) {
    this.unlinkAbort = linkAbortSignal(session.signal, this.controller);
  }

  async appendAudio(frame: PcmAudioFrame): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    assertPcmFrame(frame);

    if (this.sampleRate !== undefined && frame.sampleRate !== this.sampleRate) {
      throw new Error(
        `${this.provider.name} transcription session started at ${this.sampleRate} Hz and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }

    const nextBytes = this.audioBytes + frame.samples.byteLength;
    if (nextBytes + 44 > this.provider.maxAudioBytes) {
      throw new RangeError(
        `${this.provider.name} transcription audio exceeds the configured ${this.provider.maxAudioBytes}-byte limit`,
      );
    }

    this.sampleRate ??= frame.sampleRate;
    this.audioBytes = nextBytes;
    this.chunks.push(new Int16Array(frame.samples));
  }

  async finish(): Promise<TranscriptionResult> {
    return this.transcribe(true);
  }

  async commit(): Promise<TranscriptionResult> {
    return this.transcribe(false);
  }

  private async transcribe(final: boolean): Promise<TranscriptionResult> {
    this.assertOpen();
    if (this.sampleRate === undefined || this.audioBytes === 0) {
      throw new Error("Cannot transcribe an empty audio session");
    }
    this.state = "finishing";
    throwIfAborted(this.controller.signal);

    try {
      const result = await this.provider.transcribe(
        encodeMonoPcmAsWav(this.chunks, this.sampleRate),
        this.controller.signal,
      );
      this.session.onTranscript?.({ type: "final", ...result });
      if (final) {
        this.state = "finished";
      } else {
        this.chunks.length = 0;
        this.sampleRate = undefined;
        this.audioBytes = 0;
        this.state = "open";
      }
      return result;
    } catch (error) {
      if (!final) this.state = "open";
      throw error;
    } finally {
      if (final) this.unlinkAbort();
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.controller.abort();
    this.unlinkAbort();
    this.chunks.length = 0;
  }

  private assertOpen(): void {
    if (this.state !== "open") {
      throw new Error(`Speech-to-text session is ${this.state}`);
    }
  }
}
