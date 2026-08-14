import {
  assertPcmFrame,
  createAbortError,
  encodePcmAsBase64,
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
import {
  createNodeWebSocket,
  socketDataToText,
  websocketURL,
  type RealtimeSpeechWebSocket,
  type RealtimeSpeechWebSocketFactory,
} from "./realtime-websocket.js";

export type {
  RealtimeSpeechWebSocket,
  RealtimeSpeechWebSocketData,
  RealtimeSpeechWebSocketFactory,
} from "./realtime-websocket.js";

type SocketEvent = { data?: unknown; error?: unknown };

export type OpenAIRealtimeSpeechToTextOptions = {
  apiKey: string;
  model?: string;
  baseURL?: string;
  prompt?: string;
  language?: string;
  headers?: Record<string, string>;
  turnDetection?: null | OpenAIRealtimeTranscriptionTurnDetection;
  noiseReduction?: null | { type: "near_field" | "far_field" };
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

export type OpenAIRealtimeTranscriptionTurnDetection =
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

type OpenAIRealtimeSpeechToTextConfig = Required<Pick<
  OpenAIRealtimeSpeechToTextOptions,
  "apiKey" | "model" | "baseURL" | "createWebSocket"
>> & Omit<
  OpenAIRealtimeSpeechToTextOptions,
  "apiKey" | "model" | "baseURL" | "createWebSocket"
>;

export class OpenAIRealtimeSpeechToText implements SpeechToTextProvider {
  readonly inputFormat = {
    encoding: "pcm_s16le" as const,
    channels: 1 as const,
    sampleRate: 24000,
  };

  private readonly options: OpenAIRealtimeSpeechToTextConfig;

  constructor(options: OpenAIRealtimeSpeechToTextOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAI realtime speech-to-text requires an API key");
    }
    this.options = {
      ...options,
      model: options.model ?? "gpt-4o-mini-transcribe",
      baseURL: options.baseURL ?? "https://api.openai.com/v1",
      createWebSocket: options.createWebSocket ?? createNodeWebSocket,
    };
  }

  async createSession(
    options: SpeechToTextSessionOptions = {},
  ): Promise<SpeechToTextSession> {
    const session = new OpenAIRealtimeSpeechToTextSession(this.options, options);
    try {
      await session.connect();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
}

class OpenAIRealtimeSpeechToTextSession implements SpeechToTextSession {
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private socket?: RealtimeSpeechWebSocket;
  private state: "connecting" | "open" | "closed" = "connecting";
  private uncommittedAudioBytes = 0;
  private commitPending = false;
  private configurationSent = false;
  private resolveConfigured?: () => void;
  private rejectConfigured?: (error: Error) => void;
  private resolveCommit?: (result: TranscriptionResult) => void;
  private rejectCommit?: (error: Error) => void;

  private readonly onOpen = (): void => {
    if (this.configurationSent) return;
    try {
      this.send({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: {
                model: this.provider.model,
                ...(this.provider.prompt ? { prompt: this.provider.prompt } : {}),
                ...(this.provider.language
                  ? { language: this.provider.language }
                  : {}),
              },
              turn_detection: this.provider.turnDetection ?? null,
              ...(this.provider.noiseReduction === undefined
                ? {}
                : { noise_reduction: this.provider.noiseReduction }),
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
    void this.handleMessage(event.data).catch(error => this.fail(toError(error)));
  };

  private readonly onError = (event: SocketEvent): void => {
    this.fail(toError(event.error, "OpenAI realtime transcription failed"));
  };

  private readonly onClose = (): void => {
    if (this.state === "closed") return;
    this.fail(new Error("OpenAI realtime transcription connection closed"));
  };

  constructor(
    private readonly provider: OpenAIRealtimeSpeechToTextConfig,
    private readonly session: SpeechToTextSessionOptions,
  ) {
    this.unlinkAbort = linkAbortSignal(session.signal, this.controller);
    this.controller.signal.addEventListener("abort", () => {
      this.fail(createAbortError());
    }, { once: true });
  }

  async connect(): Promise<void> {
    throwIfAborted(this.controller.signal);
    const socket = await this.provider.createWebSocket(
      realtimeTranscriptionURL(this.provider.baseURL),
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
        reject(new Error(
          "OpenAI realtime transcription connection closed during setup",
        ));
      }
    });
  }

  async appendAudio(frame: PcmAudioFrame): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (this.commitPending) {
      throw new Error("Cannot append audio while a transcript commit is pending");
    }
    assertPcmFrame(frame);
    if (frame.sampleRate !== 24000) {
      throw new Error(
        `OpenAI realtime transcription requires 24000 Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }
    if (frame.samples.length === 0) return;
    this.send({
      type: "input_audio_buffer.append",
      audio: encodePcmAsBase64(frame.samples),
    });
    this.uncommittedAudioBytes += frame.samples.byteLength;
  }

  async commit(): Promise<TranscriptionResult> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (this.uncommittedAudioBytes === 0) {
      throw new Error("Cannot transcribe an empty audio turn");
    }
    if (this.commitPending) {
      throw new Error("A transcript commit is already pending");
    }
    this.commitPending = true;
    this.uncommittedAudioBytes = 0;

    const result = new Promise<TranscriptionResult>((resolve, reject) => {
      this.resolveCommit = resolve;
      this.rejectCommit = reject;
    });
    try {
      this.send({ type: "input_audio_buffer.commit" });
    } catch (error) {
      this.fail(toError(error));
    }
    return result;
  }

  async finish(): Promise<TranscriptionResult> {
    try {
      return await this.commit();
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.rejectConfigured?.(createAbortError());
    this.rejectCommit?.(createAbortError());
    this.cleanupSocket();
    this.socket?.close();
    this.unlinkAbort();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await socketDataToText(data);
    const event = JSON.parse(text) as Record<string, unknown>;
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "session.updated" || type === "transcription_session.updated") {
      this.state = "open";
      this.resolveConfigured?.();
      this.resolveConfigured = undefined;
      this.rejectConfigured = undefined;
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      if (typeof event.delta === "string" && event.delta) {
        this.session.onTranscript?.({ type: "delta", text: event.delta });
      }
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      if (typeof event.transcript !== "string") {
        this.fail(new Error(
          "OpenAI realtime transcription completion did not include text",
        ));
        return;
      }
      const result = { text: event.transcript };
      this.session.onTranscript?.({ type: "final", ...result });
      this.commitPending = false;
      const resolve = this.resolveCommit;
      this.resolveCommit = undefined;
      this.rejectCommit = undefined;
      resolve?.(result);
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      this.session.onSpeechActivity?.({
        type: "start",
        ...(typeof event.audio_start_ms === "number"
          ? { audioOffsetMs: event.audio_start_ms }
          : {}),
      });
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      this.session.onSpeechActivity?.({
        type: "end",
        ...(typeof event.audio_end_ms === "number"
          ? { audioOffsetMs: event.audio_end_ms }
          : {}),
      });
      return;
    }
    if (type === "input_audio_buffer.committed") {
      this.uncommittedAudioBytes = 0;
      return;
    }
    if (type === "error") {
      const providerError = event.error as { message?: unknown } | undefined;
      this.fail(new Error(
        typeof providerError?.message === "string"
          ? providerError.message
          : "OpenAI realtime transcription returned an error",
      ));
    }
  }

  private send(event: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("OpenAI realtime transcription connection is not open");
    }
    this.socket.send(JSON.stringify(event));
  }

  private fail(error: Error): void {
    this.rejectConfigured?.(error);
    this.rejectCommit?.(error);
    this.resolveConfigured = undefined;
    this.rejectConfigured = undefined;
    this.resolveCommit = undefined;
    this.rejectCommit = undefined;
    if (this.state !== "closed") {
      this.state = "closed";
      this.cleanupSocket();
      this.socket?.close();
      this.unlinkAbort();
    }
  }

  private assertOpen(): void {
    if (this.state !== "open") {
      throw new Error(`Speech-to-text session is ${this.state}`);
    }
  }

  private cleanupSocket(): void {
    this.socket?.removeEventListener("open", this.onOpen);
    this.socket?.removeEventListener("message", this.onMessage);
    this.socket?.removeEventListener("error", this.onError);
    this.socket?.removeEventListener("close", this.onClose);
  }
}

function realtimeTranscriptionURL(baseURL: string): string {
  return websocketURL(baseURL, "/realtime?intent=transcription");
}

function toError(value: unknown, fallback = "OpenAI realtime transcription failed"): Error {
  return value instanceof Error ? value : new Error(fallback);
}
