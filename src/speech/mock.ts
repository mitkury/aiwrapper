import {
  assertPcmFrame,
  createAbortError,
  linkAbortSignal,
  throwIfAborted,
} from "./audio.js";
import type {
  PcmAudioFormat,
  PcmAudioFrame,
  SpeechToTextProvider,
  SpeechToTextSession,
  SpeechToTextSessionOptions,
  TextToSpeechOptions,
  TextToSpeechProvider,
  TranscriptionResult,
} from "./types.js";

export type MockSpeechToTextOptions = {
  transcript?: string | ((frames: readonly PcmAudioFrame[]) => string);
  languages?: string[];
};

export class MockSpeechToText implements SpeechToTextProvider {
  readonly inputFormat = {
    encoding: "pcm_s16le" as const,
    channels: 1 as const,
  };

  constructor(private readonly options: MockSpeechToTextOptions = {}) {}

  async createSession(
    options: SpeechToTextSessionOptions = {},
  ): Promise<SpeechToTextSession> {
    return new MockSpeechToTextSession(this.options, options);
  }
}

class MockSpeechToTextSession implements SpeechToTextSession {
  private readonly frames: PcmAudioFrame[] = [];
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private state: "open" | "finished" | "closed" = "open";
  private sampleRate?: number;

  constructor(
    private readonly provider: MockSpeechToTextOptions,
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
        `Mock speech-to-text cannot accept ${frame.sampleRate} Hz after ${this.sampleRate} Hz without resampling`,
      );
    }
    this.sampleRate = frame.sampleRate;
    this.frames.push({ ...frame, samples: new Int16Array(frame.samples) });
  }

  async finish(): Promise<TranscriptionResult> {
    return this.transcribe(true);
  }

  async commit(): Promise<TranscriptionResult> {
    return this.transcribe(false);
  }

  private async transcribe(final: boolean): Promise<TranscriptionResult> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (this.frames.length === 0) {
      throw new Error("Cannot transcribe an empty audio turn");
    }
    const text = typeof this.provider.transcript === "function"
      ? this.provider.transcript(this.frames)
      : this.provider.transcript ?? "Mock transcript";
    const result = {
      text,
      ...(this.provider.languages
        ? { languages: [...this.provider.languages] }
        : {}),
    };
    this.session.onTranscript?.({ type: "final", ...result });
    if (final) {
      this.state = "finished";
    } else {
      this.frames.length = 0;
      this.sampleRate = undefined;
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.controller.abort();
    this.unlinkAbort();
    this.frames.length = 0;
    this.sampleRate = undefined;
  }

  private assertOpen(): void {
    if (this.state !== "open") {
      throw new Error(`Speech-to-text session is ${this.state}`);
    }
  }
}

export type MockTextToSpeechOptions = {
  sampleRate?: number;
  frames?: Int16Array[];
  delayMs?: number;
};

export class MockTextToSpeech implements TextToSpeechProvider {
  readonly outputFormat: PcmAudioFormat;
  readonly spokenTexts: string[] = [];
  private readonly frames: Int16Array[];
  private readonly delayMs: number;

  constructor(options: MockTextToSpeechOptions = {}) {
    const sampleRate = options.sampleRate ?? 24000;
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
      throw new RangeError("Mock TTS sampleRate must be a positive integer");
    }
    this.outputFormat = {
      encoding: "pcm_s16le",
      sampleRate,
      channels: 1,
    };
    this.frames = options.frames?.map(frame => new Int16Array(frame))
      ?? [new Int16Array([0])];
    this.delayMs = options.delayMs ?? 0;
    if (!Number.isFinite(this.delayMs) || this.delayMs < 0) {
      throw new RangeError("Mock TTS delayMs must be a non-negative number");
    }
  }

  async *speak(
    text: string,
    options: TextToSpeechOptions = {},
  ): AsyncIterable<PcmAudioFrame> {
    if (!text.trim()) throw new Error("Text-to-speech input cannot be empty");
    throwIfAborted(options.signal);
    this.spokenTexts.push(text);
    for (const samples of this.frames) {
      await abortableDelay(this.delayMs, options.signal);
      throwIfAborted(options.signal);
      yield {
        ...this.outputFormat,
        samples: new Int16Array(samples),
      };
    }
  }
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
