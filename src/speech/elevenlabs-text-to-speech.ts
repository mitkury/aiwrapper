import { httpRequestWithRetry as fetch } from "../http-request.js";
import { responsePcmFrames, throwIfAborted } from "./audio.js";
import type {
  PcmAudioFormat,
  PcmAudioFrame,
  TextToSpeechOptions,
  TextToSpeechProvider,
} from "./types.js";

export type ElevenLabsPcmSampleRate =
  | 8000
  | 16000
  | 22050
  | 24000
  | 44100
  | 48000;

export type ElevenLabsVoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
};

export type ElevenLabsTextToSpeechOptions = {
  apiKey: string;
  voiceId: string;
  model?: string;
  sampleRate?: ElevenLabsPcmSampleRate;
  baseURL?: string;
  languageCode?: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  headers?: Record<string, string>;
  bodyProperties?: Record<string, unknown>;
};

export class ElevenLabsTextToSpeech implements TextToSpeechProvider {
  readonly outputFormat: PcmAudioFormat;
  private readonly model: string;
  private readonly baseURL: string;

  constructor(private readonly options: ElevenLabsTextToSpeechOptions) {
    if (!options.apiKey) throw new Error("ElevenLabs text-to-speech requires an API key");
    if (!options.voiceId.trim()) {
      throw new Error("ElevenLabs text-to-speech requires a voiceId");
    }
    const sampleRate = options.sampleRate ?? 24000;
    this.outputFormat = {
      encoding: "pcm_s16le",
      sampleRate,
      channels: 1,
    };
    this.model = options.model ?? "eleven_multilingual_v2";
    this.baseURL = options.baseURL ?? "https://api.elevenlabs.io/v1";
  }

  async *speak(
    text: string,
    options: TextToSpeechOptions = {},
  ): AsyncIterable<PcmAudioFrame> {
    if (!text.trim()) throw new Error("Text-to-speech input cannot be empty");
    throwIfAborted(options.signal);

    const voiceId = options.voice?.trim() || this.options.voiceId.trim();
    const url = new URL(
      `${this.baseURL}/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    );
    url.searchParams.set("output_format", `pcm_${this.outputFormat.sampleRate}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.options.apiKey,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
        ...this.options.headers,
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        ...(this.options.languageCode
          ? { language_code: this.options.languageCode }
          : {}),
        ...(this.options.voiceSettings
          ? { voice_settings: this.options.voiceSettings }
          : {}),
        ...this.options.bodyProperties,
      }),
      signal: options.signal,
    });

    yield* responsePcmFrames(response, this.outputFormat, options.signal);
  }
}
