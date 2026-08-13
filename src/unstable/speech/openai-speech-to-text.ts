import { httpRequestWithRetry as fetch } from "../../http-request.js";
import {
  assertPcmFrame,
  encodeMonoPcmAsWav,
  linkAbortSignal,
  throwIfAborted,
} from "./audio.js";
import type {
  PcmAudioFrame,
  SpeechToTextProvider,
  SpeechToTextSession,
  SpeechToTextSessionOptions,
  TranscriptionResult,
} from "./types.js";

export type OpenAISpeechToTextOptions = {
  apiKey: string;
  model?: string;
  baseURL?: string;
  prompt?: string;
  language?: string;
  maxAudioBytes?: number;
  headers?: Record<string, string>;
};

type OpenAISpeechToTextConfig = Required<Pick<
  OpenAISpeechToTextOptions,
  "apiKey" | "model" | "baseURL" | "maxAudioBytes"
>> & Omit<
  OpenAISpeechToTextOptions,
  "apiKey" | "model" | "baseURL" | "maxAudioBytes"
>;

export class OpenAISpeechToText implements SpeechToTextProvider {
  readonly inputFormat = {
    encoding: "pcm_s16le" as const,
    channels: 1 as const,
  };

  private readonly options: OpenAISpeechToTextConfig;

  constructor(options: OpenAISpeechToTextOptions) {
    if (!options.apiKey) throw new Error("OpenAI speech-to-text requires an API key");
    const maxAudioBytes = options.maxAudioBytes ?? 24 * 1024 * 1024;
    if (!Number.isInteger(maxAudioBytes) || maxAudioBytes <= 44) {
      throw new RangeError("maxAudioBytes must be an integer greater than 44");
    }
    this.options = {
      ...options,
      model: options.model ?? "gpt-transcribe",
      baseURL: options.baseURL ?? "https://api.openai.com/v1",
      maxAudioBytes,
    };
  }

  async createSession(
    options: SpeechToTextSessionOptions = {},
  ): Promise<SpeechToTextSession> {
    return new OpenAISpeechToTextSession(this.options, options);
  }
}

class OpenAISpeechToTextSession implements SpeechToTextSession {
  private readonly chunks: Int16Array[] = [];
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private sampleRate?: number;
  private audioBytes = 0;
  private state: "open" | "finishing" | "finished" | "closed" = "open";

  constructor(
    private readonly provider: OpenAISpeechToTextConfig,
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
        `OpenAI transcription session started at ${this.sampleRate} Hz and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }

    const nextBytes = this.audioBytes + frame.samples.byteLength;
    if (nextBytes + 44 > this.provider.maxAudioBytes) {
      throw new RangeError(
        `OpenAI transcription audio exceeds the configured ${this.provider.maxAudioBytes}-byte limit`,
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
      const form = new FormData();
      form.append(
        "file",
        encodeMonoPcmAsWav(this.chunks, this.sampleRate),
        "audio.wav",
      );
      form.append("model", this.provider.model);
      if (this.provider.prompt) form.append("prompt", this.provider.prompt);
      if (this.provider.language) form.append("language", this.provider.language);

      const response = await fetch(`${this.provider.baseURL}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.provider.apiKey}`,
          ...this.provider.headers,
        },
        body: form,
        signal: this.controller.signal,
      });
      const data = await response.json() as {
        text?: unknown;
        languages?: unknown;
        language?: unknown;
      };
      if (typeof data.text !== "string") {
        throw new Error("OpenAI transcription response did not include text");
      }

      const languages = normalizeLanguages(data.languages, data.language);
      const result: TranscriptionResult = {
        text: data.text,
        ...(languages ? { languages } : {}),
      };
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

function normalizeLanguages(
  languages: unknown,
  language: unknown,
): string[] | undefined {
  if (Array.isArray(languages)) {
    const values = languages
      .map(value => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && "code" in value) {
          const code = (value as { code?: unknown }).code;
          return typeof code === "string" ? code : undefined;
        }
        return undefined;
      })
      .filter((value): value is string => Boolean(value));
    if (values.length > 0) return values;
  }
  return typeof language === "string" && language.length > 0
    ? [language]
    : undefined;
}
