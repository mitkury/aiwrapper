import {
  createNodeWebSocket,
  websocketURL,
} from "../speech/realtime-websocket.js";
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

export type OpenAIRealtimeTurnDetection =
  | {
      type: "server_vad";
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
    }
  | {
      type: "semantic_vad";
      eagerness?: "low" | "medium" | "high" | "auto";
    };

export type OpenAIRealtimeSpeechToSpeechOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  transcriptionModel?: string;
  turnDetection?: OpenAIRealtimeTurnDetection;
  noiseReduction?: null | { type: "near_field" | "far_field" };
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

type OpenAIRealtimeSpeechToSpeechConfig = Required<
  Pick<
    OpenAIRealtimeSpeechToSpeechOptions,
    | "apiKey"
    | "model"
    | "voice"
    | "baseURL"
    | "transcriptionModel"
    | "createWebSocket"
  >
> &
  Omit<
    OpenAIRealtimeSpeechToSpeechOptions,
    | "apiKey"
    | "model"
    | "voice"
    | "baseURL"
    | "transcriptionModel"
    | "createWebSocket"
  >;

export class OpenAIRealtimeSpeechToSpeech implements SpeechToSpeechProvider {
  readonly inputFormat;
  readonly outputFormat;
  private readonly protocol: OpenAICompatibleRealtimeSpeechToSpeech;

  constructor(options: OpenAIRealtimeSpeechToSpeechOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAI realtime speech-to-speech requires an API key");
    }
    const config: OpenAIRealtimeSpeechToSpeechConfig = {
      ...options,
      model: options.model ?? "gpt-realtime-2.1",
      voice: options.voice ?? "marin",
      baseURL: options.baseURL ?? "https://api.openai.com/v1",
      transcriptionModel:
        options.transcriptionModel ?? "gpt-4o-mini-transcribe",
      createWebSocket: options.createWebSocket ?? createNodeWebSocket,
    };
    this.protocol = new OpenAICompatibleRealtimeSpeechToSpeech(
      openAIProtocolConfig(config),
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

function openAIProtocolConfig(
  config: OpenAIRealtimeSpeechToSpeechConfig,
): OpenAICompatibleRealtimeSpeechToSpeechConfig {
  return {
    providerName: "OpenAI realtime",
    audioLabel: "OpenAI",
    url: `${websocketURL(config.baseURL, "/realtime")}?model=${encodeURIComponent(config.model)}`,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...config.headers,
    },
    createWebSocket: config.createWebSocket,
    createSessionUpdate: (session) => {
      const tools = speechToSpeechFunctionDeclarations(session);
      return {
        type: "session.update",
        session: {
          type: "realtime",
          output_modalities: ["audio"],
          ...(session.instructions
            ? { instructions: session.instructions }
            : {}),
          ...(tools.length
            ? {
                tools: tools.map((tool) => ({ type: "function", ...tool })),
                tool_choice: "auto",
              }
            : {}),
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: config.transcriptionModel },
              noise_reduction:
                config.noiseReduction === undefined
                  ? { type: "near_field" }
                  : config.noiseReduction,
              turn_detection: {
                ...(config.turnDetection ?? {
                  type: "server_vad",
                  silence_duration_ms: 350,
                  prefix_padding_ms: 300,
                }),
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              format: { type: "audio/pcm", rate: 24000 },
              voice: config.voice,
            },
          },
        },
      };
    },
  };
}
