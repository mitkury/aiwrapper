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

export type XAIVoiceSpeechToSpeechOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  transcriptionModel?: string;
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

type XAIVoiceSpeechToSpeechConfig = Required<
  Pick<
    XAIVoiceSpeechToSpeechOptions,
    | "apiKey"
    | "model"
    | "voice"
    | "baseURL"
    | "transcriptionModel"
    | "createWebSocket"
  >
> &
  Omit<
    XAIVoiceSpeechToSpeechOptions,
    | "apiKey"
    | "model"
    | "voice"
    | "baseURL"
    | "transcriptionModel"
    | "createWebSocket"
  >;

export class XAIVoiceSpeechToSpeech implements SpeechToSpeechProvider {
  readonly inputFormat;
  readonly outputFormat;
  private readonly protocol: OpenAICompatibleRealtimeSpeechToSpeech;

  constructor(options: XAIVoiceSpeechToSpeechOptions) {
    if (!options.apiKey) {
      throw new Error("xAI Voice speech-to-speech requires an API key");
    }
    const config: XAIVoiceSpeechToSpeechConfig = {
      ...options,
      model: options.model ?? "grok-voice-think-fast-2.0",
      voice: options.voice ?? "eve",
      baseURL: options.baseURL ?? "https://api.x.ai/v1",
      transcriptionModel: options.transcriptionModel ?? "grok-transcribe",
      createWebSocket: options.createWebSocket ?? createNodeWebSocket,
    };
    this.protocol = new OpenAICompatibleRealtimeSpeechToSpeech(
      xaiProtocolConfig(config),
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

function xaiProtocolConfig(
  config: XAIVoiceSpeechToSpeechConfig,
): OpenAICompatibleRealtimeSpeechToSpeechConfig {
  return {
    providerName: "xAI Voice",
    audioLabel: "xAI Voice",
    url: `${websocketURL(config.baseURL, "/realtime")}?model=${encodeURIComponent(config.model)}`,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...config.headers,
    },
    createWebSocket: config.createWebSocket,
    recoverableServerErrors: true,
    createSessionUpdate: (session) => {
      const tools = speechToSpeechFunctionDeclarations(session);
      return {
        type: "session.update",
        session: {
          voice: config.voice,
          ...(session.instructions
            ? { instructions: session.instructions }
            : {}),
          ...(tools.length
            ? {
                tools: tools.map((tool) => ({ type: "function", ...tool })),
                tool_choice: "auto",
              }
            : {}),
          turn_detection: { type: "server_vad" },
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: config.transcriptionModel },
            },
            output: {
              format: { type: "audio/pcm", rate: 24000 },
            },
          },
        },
      };
    },
  };
}
