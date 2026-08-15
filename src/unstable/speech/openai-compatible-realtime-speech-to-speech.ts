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
  socketDataToText,
  type RealtimeSpeechWebSocket,
  type RealtimeSpeechWebSocketFactory,
} from "../../speech/realtime-websocket.js";
import type {
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import { createObservableSpeechToSpeechSession } from "./session-events.js";

type SocketEvent = {
  data?: unknown;
  error?: unknown;
  code?: unknown;
  reason?: unknown;
};

export type OpenAICompatibleRealtimeSpeechToSpeechConfig = {
  providerName: string;
  audioLabel: string;
  url: string;
  headers: Record<string, string>;
  createWebSocket: RealtimeSpeechWebSocketFactory;
  createSessionUpdate: (
    options: SpeechToSpeechSessionOptions,
  ) => Record<string, unknown>;
  recoverableServerErrors?: boolean;
};

const pcm24k: PcmAudioFormat = {
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate: 24000,
};

export class OpenAICompatibleRealtimeSpeechToSpeech implements SpeechToSpeechProvider {
  readonly inputFormat = pcm24k;
  readonly outputFormat = pcm24k;

  constructor(
    private readonly config: OpenAICompatibleRealtimeSpeechToSpeechConfig,
  ) {}

  async createSession(
    options: SpeechToSpeechSessionOptions = {},
  ): Promise<SpeechToSpeechSession> {
    return createObservableSpeechToSpeechSession(options, async (events) => {
      const session = new OpenAICompatibleRealtimeSpeechToSpeechSession(
        this.config,
        events,
      );
      try {
        await session.connect();
        return session;
      } catch (error) {
        await session.close();
        throw error;
      }
    });
  }
}

class OpenAICompatibleRealtimeSpeechToSpeechSession {
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
      this.send(this.provider.createSessionUpdate(this.session));
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
    this.fail(
      toError(
        event.error,
        `${this.provider.providerName} speech-to-speech failed`,
      ),
    );
  };

  private readonly onClose = (event: SocketEvent): void => {
    if (this.state === "closed") return;
    this.fail(providerCloseError(this.provider.providerName, event));
  };

  constructor(
    private readonly provider: OpenAICompatibleRealtimeSpeechToSpeechConfig,
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
      this.provider.url,
      this.provider.headers,
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
            `${this.provider.providerName} speech-to-speech connection closed during setup`,
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
        `${this.provider.providerName} speech-to-speech requires ${pcm24k.sampleRate} Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
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
    if (
      type === "response.output_audio.delta" ||
      type === "response.audio.delta"
    ) {
      if (typeof event.delta === "string" && event.delta) {
        this.session.onEvent?.({
          type: "output-audio",
          frame: {
            ...pcm24k,
            samples: decodeBase64Pcm(event.delta, this.provider.audioLabel),
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
      this.emitTranscript(
        "input-transcript",
        "final",
        event.transcript,
        event.item_id,
      );
      return;
    }
    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      this.emitTranscript("output-transcript", "delta", event.delta);
      return;
    }
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      this.emitTranscript(
        "output-transcript",
        "final",
        event.transcript,
        event.item_id,
      );
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
              : `${this.provider.providerName} realtime response failed`,
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
      const error = new Error(
        typeof providerError?.message === "string"
          ? providerError.message
          : `${this.provider.providerName} speech-to-speech returned an error`,
      );
      if (
        this.state === "connecting" ||
        !this.provider.recoverableServerErrors
      ) {
        this.fail(error);
      } else {
        this.emitError(error);
      }
    }
  }

  private emitTranscript(
    type: "input-transcript" | "output-transcript",
    transcriptType: "delta" | "final",
    value: unknown,
    id?: unknown,
  ): void {
    if (typeof value !== "string" || !value) return;
    this.session.onEvent?.({
      type,
      transcript: {
        type: transcriptType,
        text: value,
        ...(typeof id === "string" && id ? { id } : {}),
      },
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
        `${this.provider.providerName} speech-to-speech connection is not open`,
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

function providerCloseError(providerName: string, event: SocketEvent): Error {
  const code = typeof event.code === "number" ? String(event.code) : "";
  const reason = typeof event.reason === "string" ? event.reason.trim() : "";
  const details = [code, reason].filter(Boolean).join(": ");
  return new Error(
    `${providerName} speech-to-speech connection closed${details ? ` (${details})` : ""}`,
  );
}

function toError(
  value: unknown,
  fallback = "Realtime speech-to-speech failed",
): Error {
  return value instanceof Error ? value : new Error(fallback);
}
