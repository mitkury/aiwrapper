import { httpRequestWithRetry as fetch } from "../../http-request.js";
import { responsePcmFrames, throwIfAborted } from "./audio.js";
import type {
  PcmAudioFormat,
  PcmAudioFrame,
  TextToSpeechOptions,
  TextToSpeechProvider,
} from "./types.js";

export type OpenAITextToSpeechOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  instructions?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  bodyProperties?: Record<string, unknown>;
};

export class OpenAITextToSpeech implements TextToSpeechProvider {
  readonly outputFormat: PcmAudioFormat = {
    encoding: "pcm_s16le",
    sampleRate: 24000,
    channels: 1,
  };

  private readonly model: string;
  private readonly voice: string;
  private readonly baseURL: string;

  constructor(private readonly options: OpenAITextToSpeechOptions) {
    if (!options.apiKey) throw new Error("OpenAI text-to-speech requires an API key");
    this.model = options.model ?? "gpt-4o-mini-tts";
    this.voice = options.voice?.trim() || "coral";
    this.baseURL = options.baseURL ?? "https://api.openai.com/v1";
  }

  async *speak(
    text: string,
    options: TextToSpeechOptions = {},
  ): AsyncIterable<PcmAudioFrame> {
    if (!text.trim()) throw new Error("Text-to-speech input cannot be empty");
    throwIfAborted(options.signal);

    const response = await fetch(`${this.baseURL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
        ...this.options.headers,
      },
      body: JSON.stringify({
        ...this.options.bodyProperties,
        model: this.model,
        voice: options.voice?.trim() || this.voice,
        input: text,
        response_format: "pcm",
        ...(this.options.instructions
          ? { instructions: this.options.instructions }
          : {}),
      }),
      signal: options.signal,
    });

    yield* responsePcmFrames(response, this.outputFormat, options.signal);
  }
}
