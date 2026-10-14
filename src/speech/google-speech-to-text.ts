import { encodeBytesAsBase64 } from "../base64.js";
import { httpRequestWithRetry as fetch } from "../http-request.js";
import { BufferedTranscriptionSession } from "./buffered-transcription.js";
import type {
  SpeechToTextProvider,
  SpeechToTextSession,
  SpeechToTextSessionOptions,
  TranscriptionResult,
} from "./types.js";

export type GoogleSpeechToTextOptions = {
  apiKey: string;
  /** A Gemini transcription model, or any Gemini model that hears audio. */
  model?: string;
  baseURL?: string;
  prompt?: string;
  /** Gemini takes inline requests up to 20 MB. */
  maxAudioBytes?: number;
  headers?: Record<string, string>;
};

const DEFAULT_PROMPT = "Transcribe this audio verbatim. Reply with the transcript only.";

type GeminiPart = { text?: unknown; audioTranscription?: { text?: unknown } };

/**
 * Speech to text with Gemini: one generateContent call per utterance, the audio
 * inline. Sessions take PCM like the other adapters; `transcribe()` takes a
 * recorded file as is (WAV, WebM, Ogg, MP3, M4A, FLAC).
 */
export class GoogleSpeechToText implements SpeechToTextProvider {
  readonly inputFormat = {
    encoding: "pcm_s16le" as const,
    channels: 1 as const,
  };

  private readonly options: Required<Pick<
    GoogleSpeechToTextOptions,
    "apiKey" | "model" | "baseURL" | "prompt" | "maxAudioBytes"
  >> & Pick<GoogleSpeechToTextOptions, "headers">;

  constructor(options: GoogleSpeechToTextOptions) {
    if (!options.apiKey) throw new Error("Google speech-to-text requires an API key");
    const maxAudioBytes = options.maxAudioBytes ?? 20 * 1024 * 1024;
    if (!Number.isInteger(maxAudioBytes) || maxAudioBytes <= 44) {
      throw new RangeError("maxAudioBytes must be an integer greater than 44");
    }
    this.options = {
      ...options,
      model: options.model ?? "gemini-3.5-transcribe",
      baseURL: options.baseURL ?? "https://generativelanguage.googleapis.com/v1beta",
      prompt: options.prompt ?? DEFAULT_PROMPT,
      maxAudioBytes,
    };
  }

  async createSession(
    options: SpeechToTextSessionOptions = {},
  ): Promise<SpeechToTextSession> {
    return new BufferedTranscriptionSession({
      name: "Google",
      maxAudioBytes: this.options.maxAudioBytes,
      transcribe: (wav, signal) => this.transcribe(wav, { signal }),
    }, options);
  }

  /** Transcribes a recorded file; its type comes from the blob or `mimeType`. */
  async transcribe(
    audio: Blob,
    { mimeType, signal }: { mimeType?: string; signal?: AbortSignal } = {},
  ): Promise<TranscriptionResult> {
    if (audio.size > this.options.maxAudioBytes) {
      throw new RangeError(
        `Google transcription audio exceeds the configured ${this.options.maxAudioBytes}-byte limit`,
      );
    }
    const type = (mimeType || audio.type || "audio/wav").split(";")[0];
    const response = await fetch(
      `${this.options.baseURL}/models/${this.options.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.options.apiKey,
          ...this.options.headers,
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: type, data: encodeBytesAsBase64(new Uint8Array(await audio.arrayBuffer())) } },
              { text: this.options.prompt },
            ],
          }],
        }),
        signal,
      },
    );
    const data = await response.json() as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    const parts = data.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      throw new Error("Google transcription response did not include text");
    }
    // Transcription models answer audioTranscription parts; others answer text.
    const text = parts
      .map((part) => part.audioTranscription?.text ?? part.text)
      .filter((value): value is string => typeof value === "string")
      .join("")
      .trim();
    return { text };
  }
}
