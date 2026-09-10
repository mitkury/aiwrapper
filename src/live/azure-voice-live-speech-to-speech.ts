import { createNodeWebSocket } from "../speech/realtime-websocket.js";
import type { RealtimeSpeechWebSocketFactory } from "../speech/realtime-websocket.js";
import {
  OpenAICompatibleRealtimeSpeechToSpeech,
  type OpenAICompatibleRealtimeSpeechToSpeechConfig,
} from "./openai-compatible-realtime-speech-to-speech.js";
import type {
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import { speechToSpeechFunctionDeclarations } from "./live-lang-tools.js";

export type AzureVoiceLiveVoiceType = "openai" | "azure-standard";

export type AzureVoiceLiveSpeechToSpeechOptions = {
  endpoint: string;
  apiKey?: string;
  accessToken?: string;
  model?: string;
  voice?: string;
  voiceType?: AzureVoiceLiveVoiceType;
  apiVersion?: string;
  transcriptionModel?: string;
  headers?: Record<string, string>;
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

type AzureVoiceLiveSpeechToSpeechConfig = Required<
  Pick<
    AzureVoiceLiveSpeechToSpeechOptions,
    | "endpoint"
    | "model"
    | "voice"
    | "voiceType"
    | "apiVersion"
    | "transcriptionModel"
    | "createWebSocket"
  >
> &
  Omit<
    AzureVoiceLiveSpeechToSpeechOptions,
    | "endpoint"
    | "model"
    | "voice"
    | "voiceType"
    | "apiVersion"
    | "transcriptionModel"
    | "createWebSocket"
  >;

export class AzureVoiceLiveSpeechToSpeech implements SpeechToSpeechProvider {
  readonly inputFormat;
  readonly outputFormat;
  private readonly protocol: OpenAICompatibleRealtimeSpeechToSpeech;

  constructor(options: AzureVoiceLiveSpeechToSpeechOptions) {
    if (!options.endpoint) {
      throw new Error("Azure Voice Live speech-to-speech requires an endpoint");
    }
    if (!options.apiKey && !options.accessToken) {
      throw new Error(
        "Azure Voice Live speech-to-speech requires an API key or access token",
      );
    }
    const config: AzureVoiceLiveSpeechToSpeechConfig = {
      ...options,
      endpoint: options.endpoint,
      model: options.model ?? "gpt-realtime",
      voice: options.voice ?? "alloy",
      voiceType: options.voiceType ?? "openai",
      apiVersion: options.apiVersion ?? "2026-04-10",
      transcriptionModel: options.transcriptionModel ?? "whisper-1",
      createWebSocket: options.createWebSocket ?? createNodeWebSocket,
    };
    this.protocol = new OpenAICompatibleRealtimeSpeechToSpeech(
      azureVoiceLiveProtocolConfig(config),
    );
    this.inputFormat = this.protocol.inputFormat;
    this.outputFormat = this.protocol.outputFormat;
  }

  async createSession(
    options: SpeechToSpeechSessionOptions = {},
  ): Promise<SpeechToSpeechSession> {
    return this.protocol.createSession(options);
  }
}

function azureVoiceLiveProtocolConfig(
  config: AzureVoiceLiveSpeechToSpeechConfig,
): OpenAICompatibleRealtimeSpeechToSpeechConfig {
  return {
    providerName: "Azure Voice Live",
    audioLabel: "Azure Voice Live",
    url: voiceLiveURL(config),
    headers: {
      ...(config.accessToken
        ? { Authorization: `Bearer ${config.accessToken}` }
        : config.apiKey
          ? { "api-key": config.apiKey }
          : {}),
      ...config.headers,
    },
    createWebSocket: config.createWebSocket,
    createSessionUpdate: (session) => {
      const tools = speechToSpeechFunctionDeclarations(session);
      return {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          voice: { type: config.voiceType, name: config.voice },
          ...(session.instructions
            ? { instructions: session.instructions }
            : {}),
          ...(tools.length
            ? {
                tools: tools.map((tool) => ({ type: "function", ...tool })),
                tool_choice: "auto",
              }
            : {}),
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_sampling_rate: 24000,
          input_audio_transcription: { model: config.transcriptionModel },
          turn_detection: {
            type: "azure_semantic_vad",
            threshold: 0.5,
            prefix_padding_ms: 420,
            silence_duration_ms: 500,
          },
        },
      };
    },
  };
}

function voiceLiveURL(config: AzureVoiceLiveSpeechToSpeechConfig): string {
  const url = new URL(config.endpoint);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("Azure Voice Live endpoint must use HTTPS or WSS");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/voice-live/realtime")) {
    url.pathname = `${pathname}/voice-live/realtime`;
  } else {
    url.pathname = pathname;
  }
  url.searchParams.set("api-version", config.apiVersion);
  url.searchParams.set("model", config.model);
  return url.toString();
}
