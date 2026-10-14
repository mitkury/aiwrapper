import { httpRequestWithRetry as fetch } from "../http-request.js";
import { BufferedTranscriptionSession } from "./buffered-transcription.js";
import type {
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
    return new BufferedTranscriptionSession({
      name: "OpenAI",
      maxAudioBytes: this.options.maxAudioBytes,
      transcribe: (wav, signal) => this.transcribe(wav, signal),
    }, options);
  }

  private async transcribe(wav: Blob, signal: AbortSignal): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append("file", wav, "audio.wav");
    form.append("model", this.options.model);
    if (this.options.prompt) form.append("prompt", this.options.prompt);
    if (this.options.language) form.append("language", this.options.language);

    const response = await fetch(`${this.options.baseURL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.headers,
      },
      body: form,
      signal,
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
    return {
      text: data.text,
      ...(languages ? { languages } : {}),
    };
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
