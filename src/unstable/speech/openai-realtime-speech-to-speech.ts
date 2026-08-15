import {
  assertPcmFrame,
  createAbortError,
  decodeBase64Pcm,
  encodePcmAsBase64,
  linkAbortSignal,
  throwIfAborted,
} from "../../speech/audio.js";
import type { PcmAudioFormat, PcmAudioFrame } from "../../speech/types.js";
import {
  createNodeWebSocket,
  socketDataToText,
  websocketURL,
  type RealtimeSpeechWebSocket,
  type RealtimeSpeechWebSocketFactory,
} from "../../speech/realtime-websocket.js";
import type {
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";

type SocketEvent = { data?: unknown; error?: unknown };

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

const pcm24k: PcmAudioFormat = {
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate: 24000,
};

export class OpenAIRealtimeSpeechToSpeech
  implements SpeechToSpeechProvider
{
  readonly inputFormat = pcm24k;
  readonly outputFormat = pcm24k;
  private readonly options: OpenAIRealtimeSpeechToSpeechConfig;

  constructor(options: OpenAIRealtimeSpeechToSpeechOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAI realtime speech-to-speech requires an API key");
    }
    this.options = {
      ...options,
      model: options.model ?? "gpt-realtime-2.1",
      voice: options.voice ?? "marin",
      baseURL: options.baseURL ?? "https://api.openai.com/v1",
      transcriptionModel:
        options.transcriptionModel ?? "gpt-4o-mini-transcribe",
      createWebSocket: options.createWebSocket ?? createNodeWebSocket,
    };
  }

  async createSession(
    options: SpeechToSpeechSessionOptions = {},
  ): Promise<SpeechToSpeechSession> {
    const session = new OpenAIRealtimeSpeechToSpeechSession(
      this.options,
      options,
    );
    try {
      await session.connect();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
}

class OpenAIRealtimeSpeechToSpeechSession implements SpeechToSpeechSession {
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private socket?: RealtimeSpeechWebSocket;
  private state: "connecting" | "open" | "closed" = "connecting";
  private configurationSent = false;
  private responseActive = false;
  private responseInterrupted = false;
  private resolveConfigured?: () => void;
  private rejectConfigured?: (error: Error) => void;

  private readonly onOpen = (): void => {
    if (this.configurationSent) return;
    try {
      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          output_modalities: ["audio"],
          ...(this.session.instructions
            ? { instructions: this.session.instructions }
            : {}),
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: this.provider.transcriptionModel },
              noise_reduction:
                this.provider.noiseReduction === undefined
                  ? { type: "near_field" }
                  : this.provider.noiseReduction,
              turn_detection: {
                ...(this.provider.turnDetection ?? {
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
              voice: this.provider.voice,
            },
          },
        },
      });
      this.configurationSent = true;
    } catch (error) {
      this.fail(toError(error));
    }
  };

  private readonly onMessage = (event: SocketEvent): void => {
    void this.handleMessage(event.data).catch((error) =>
      this.fail(toError(error)),
    );
  };

  private readonly onError = (event: SocketEvent): void => {
    this.fail(toError(event.error, "OpenAI realtime speech-to-speech failed"));
  };

  private readonly onClose = (): void => {
    if (this.state === "closed") return;
    this.fail(
      new Error("OpenAI realtime speech-to-speech connection closed"),
    );
  };

  constructor(
    private readonly provider: OpenAIRealtimeSpeechToSpeechConfig,
    private readonly session: SpeechToSpeechSessionOptions,
  ) {
    this.unlinkAbort = linkAbortSignal(session.signal, this.controller);
    this.controller.signal.addEventListener(
      "abort",
      () => this.fail(createAbortError()),
      { once: true },
    );
  }

  async connect(): Promise<void> {
    throwIfAborted(this.controller.signal);
    const socket = await this.provider.createWebSocket(
      openAIRealtimeURL(this.provider.baseURL, this.provider.model),
      {
        Authorization: `Bearer ${this.provider.apiKey}`,
        ...this.provider.headers,
      },
    );
    this.socket = socket;
    if (this.controller.signal.aborted) {
      socket.close();
      throw createAbortError();
    }
    socket.addEventListener("open", this.onOpen);
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("error", this.onError);
    socket.addEventListener("close", this.onClose);

    await new Promise<void>((resolve, reject) => {
      this.resolveConfigured = resolve;
      this.rejectConfigured = reject;
      if (socket.readyState === 1) {
        this.onOpen();
      } else if (socket.readyState !== 0) {
        reject(
          new Error(
            "OpenAI realtime speech-to-speech connection closed during setup",
          ),
        );
      }
    });
  }

  async appendAudio(frame: PcmAudioFrame): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    assertPcmFrame(frame);
    if (frame.sampleRate !== pcm24k.sampleRate) {
      throw new Error(
        `OpenAI realtime speech-to-speech requires ${pcm24k.sampleRate} Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }
    if (frame.samples.length === 0) return;
    this.send({
      type: "input_audio_buffer.append",
      audio: encodePcmAsBase64(frame.samples),
    });
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.rejectConfigured?.(createAbortError());
    this.resolveConfigured = undefined;
    this.rejectConfigured = undefined;
    this.cleanupSocket();
    this.socket?.close();
    this.unlinkAbort();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await socketDataToText(data);
    const event = JSON.parse(text) as Record<string, unknown>;
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "session.updated") {
      this.state = "open";
      this.resolveConfigured?.();
      this.resolveConfigured = undefined;
      this.rejectConfigured = undefined;
      return;
    }
    if (type === "response.created") {
      this.responseActive = true;
      this.responseInterrupted = false;
      this.session.onEvent?.({ type: "response-start" });
      return;
    }
    if (type === "response.output_audio.delta") {
      if (typeof event.delta === "string" && event.delta) {
        this.session.onEvent?.({
          type: "output-audio",
          frame: {
            ...pcm24k,
            samples: decodeBase64Pcm(event.delta, "OpenAI"),
          },
        });
      }
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      this.emitTranscript("input-transcript", "delta", event.delta);
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      this.emitTranscript("input-transcript", "final", event.transcript);
      return;
    }
    if (type === "response.output_audio_transcript.delta") {
      this.emitTranscript("output-transcript", "delta", event.delta);
      return;
    }
    if (type === "response.output_audio_transcript.done") {
      this.emitTranscript("output-transcript", "final", event.transcript);
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      if (this.responseActive) this.emitInterrupted();
      return;
    }
    if (type === "output_audio_buffer.cleared") {
      this.emitInterrupted();
      return;
    }
    if (type === "response.done") {
      const response = event.response as
        | {
            status?: unknown;
            status_details?: {
              error?: { message?: unknown };
            } | null;
          }
        | undefined;
      if (response?.status === "cancelled") this.emitInterrupted();
      else if (response?.status === "failed") {
        this.emitError(
          new Error(
            typeof response.status_details?.error?.message === "string"
              ? response.status_details.error.message
              : "OpenAI realtime response failed",
          ),
        );
      } else if (!this.responseInterrupted) {
        this.session.onEvent?.({ type: "response-end" });
      }
      this.responseActive = false;
      return;
    }
    if (type === "error") {
      const providerError = event.error as { message?: unknown } | undefined;
      this.fail(
        new Error(
          typeof providerError?.message === "string"
            ? providerError.message
            : "OpenAI realtime speech-to-speech returned an error",
        ),
      );
    }
  }

  private emitTranscript(
    type: "input-transcript" | "output-transcript",
    transcriptType: "delta" | "final",
    value: unknown,
  ): void {
    if (typeof value !== "string" || !value) return;
    this.session.onEvent?.({
      type,
      transcript: { type: transcriptType, text: value },
    });
  }

  private emitInterrupted(): void {
    if (!this.responseActive || this.responseInterrupted) return;
    this.responseInterrupted = true;
    this.session.onEvent?.({ type: "response-interrupted" });
  }

  private emitError(error: Error): void {
    this.session.onEvent?.({ type: "error", error });
  }

  private send(event: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error(
        "OpenAI realtime speech-to-speech connection is not open",
      );
    }
    this.socket.send(JSON.stringify(event));
  }

  private fail(error: Error): void {
    const shouldNotify = this.state === "open" && error.name !== "AbortError";
    this.rejectConfigured?.(error);
    this.resolveConfigured = undefined;
    this.rejectConfigured = undefined;
    if (this.state !== "closed") {
      this.state = "closed";
      this.cleanupSocket();
      this.socket?.close();
      this.unlinkAbort();
    }
    if (shouldNotify) {
      try {
        this.emitError(error);
      } catch {
        // A consumer callback must not prevent connection cleanup.
      }
    }
  }

  private assertOpen(): void {
    if (this.state !== "open") {
      throw new Error(`Speech-to-speech session is ${this.state}`);
    }
  }

  private cleanupSocket(): void {
    this.socket?.removeEventListener("open", this.onOpen);
    this.socket?.removeEventListener("message", this.onMessage);
    this.socket?.removeEventListener("error", this.onError);
    this.socket?.removeEventListener("close", this.onClose);
  }
}

function openAIRealtimeURL(baseURL: string, model: string): string {
  return `${websocketURL(baseURL, "/realtime")}?model=${encodeURIComponent(model)}`;
}

function toError(
  value: unknown,
  fallback = "OpenAI realtime speech-to-speech failed",
): Error {
  return value instanceof Error ? value : new Error(fallback);
}
