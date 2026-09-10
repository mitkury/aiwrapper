import {
  assertPcmFrame,
  createAbortError,
  linkAbortSignal,
  throwIfAborted,
} from "./audio.js";
import {
  createNodeWebSocket,
  socketDataToText,
  websocketURL,
  type RealtimeSpeechWebSocket,
  type RealtimeSpeechWebSocketFactory,
} from "./realtime-websocket.js";
import type {
  PcmAudioFrame,
  SpeechToTextProvider,
  SpeechToTextSession,
  SpeechToTextSessionOptions,
  TranscriptionResult,
} from "./types.js";

type SocketEvent = { data?: unknown; error?: unknown };

export type DeepgramFluxSpeechToTextOptions = {
  apiKey: string;
  model?: string;
  sampleRate?: 8000 | 16000 | 24000 | 44100 | 48000;
  baseURL?: string;
  languageHints?: string[];
  endOfTurnThreshold?: number;
  eagerEndOfTurnThreshold?: number;
  endOfTurnTimeoutMs?: number;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

type DeepgramFluxConfig = Required<Pick<
  DeepgramFluxSpeechToTextOptions,
  "apiKey" | "model" | "sampleRate" | "baseURL" | "createWebSocket"
>> & Omit<
  DeepgramFluxSpeechToTextOptions,
  "apiKey" | "model" | "sampleRate" | "baseURL" | "createWebSocket"
>;

export class DeepgramFluxSpeechToText implements SpeechToTextProvider {
  readonly inputFormat;
  private readonly options: DeepgramFluxConfig;

  constructor(options: DeepgramFluxSpeechToTextOptions) {
    if (!options.apiKey) {
      throw new Error("Deepgram Flux speech-to-text requires an API key");
    }
    this.options = {
      ...options,
      model: options.model ?? "flux-general-en",
      sampleRate: options.sampleRate ?? 24000,
      baseURL: options.baseURL ?? "https://api.deepgram.com",
      createWebSocket: options.createWebSocket ?? createNodeWebSocket,
    };
    this.inputFormat = {
      encoding: "pcm_s16le" as const,
      channels: 1 as const,
      sampleRate: this.options.sampleRate,
    };
  }

  async createSession(
    options: SpeechToTextSessionOptions = {},
  ): Promise<SpeechToTextSession> {
    const session = new DeepgramFluxSpeechToTextSession(this.options, options);
    try {
      await session.connect();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
}

class DeepgramFluxSpeechToTextSession implements SpeechToTextSession {
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private socket?: RealtimeSpeechWebSocket;
  private state: "connecting" | "open" | "closed" = "connecting";
  private uncommittedAudioBytes = 0;
  private partialText = "";
  private resolveConnected?: () => void;
  private rejectConnected?: (error: Error) => void;
  private resolveCommit?: (result: TranscriptionResult) => void;
  private rejectCommit?: (error: Error) => void;

  private readonly onOpen = (): void => {
    this.state = "open";
    this.resolveConnected?.();
    this.resolveConnected = undefined;
    this.rejectConnected = undefined;
  };

  private readonly onMessage = (event: SocketEvent): void => {
    void this.handleMessage(event.data).catch(error => this.fail(toError(error)));
  };

  private readonly onError = (event: SocketEvent): void => {
    this.fail(toError(event.error, "Deepgram Flux transcription failed"));
  };

  private readonly onClose = (): void => {
    if (this.state === "closed") return;
    this.fail(new Error("Deepgram Flux transcription connection closed"));
  };

  constructor(
    private readonly provider: DeepgramFluxConfig,
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
      deepgramFluxURL(this.provider),
      {
        Authorization: `Token ${this.provider.apiKey}`,
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
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
      if (socket.readyState === 1) this.onOpen();
      else if (socket.readyState !== 0) {
        reject(new Error(
          "Deepgram Flux transcription connection closed during setup",
        ));
      }
    });
  }

  async appendAudio(frame: PcmAudioFrame): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (this.resolveCommit) {
      throw new Error("Cannot append audio while a transcript commit is pending");
    }
    assertPcmFrame(frame);
    if (frame.sampleRate !== this.provider.sampleRate) {
      throw new Error(
        `Deepgram Flux transcription requires ${this.provider.sampleRate} Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }
    if (frame.samples.length === 0) return;
    this.socket?.send(new Uint8Array(
      frame.samples.buffer,
      frame.samples.byteOffset,
      frame.samples.byteLength,
    ));
    this.uncommittedAudioBytes += frame.samples.byteLength;
  }

  async commit(): Promise<TranscriptionResult> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (this.uncommittedAudioBytes === 0) {
      throw new Error("Cannot transcribe an empty audio turn");
    }
    if (this.resolveCommit) throw new Error("A transcript commit is already pending");
    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.resolveCommit = resolve;
      this.rejectCommit = reject;
    });
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
    this.rejectConnected?.(createAbortError());
    this.rejectCommit?.(createAbortError());
    this.cleanupSocket();
    this.socket?.close();
    this.unlinkAbort();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const event = JSON.parse(await socketDataToText(data)) as Record<string, unknown>;
    const type = typeof event.event === "string" ? event.event : "";
    const transcript = typeof event.transcript === "string" ? event.transcript : "";

    if (type === "StartOfTurn") {
      this.session.onSpeechActivity?.({ type: "start" });
      this.emitPartial(transcript);
      return;
    }
    if (type === "Update" || type === "EagerEndOfTurn" || type === "TurnResumed") {
      this.emitPartial(transcript);
      return;
    }
    if (type === "EndOfTurn") {
      const result = {
        text: transcript,
        ...languagesFrom(event),
      };
      this.session.onSpeechActivity?.({ type: "end" });
      this.session.onTranscript?.({ type: "final", ...result });
      this.partialText = "";
      this.uncommittedAudioBytes = 0;
      const resolve = this.resolveCommit;
      this.resolveCommit = undefined;
      this.rejectCommit = undefined;
      resolve?.(result);
      return;
    }
    if (type === "Error" || type === "error") {
      this.fail(new Error(providerMessage(event, "Deepgram Flux returned an error")));
    }
  }

  private emitPartial(text: string): void {
    if (!text || text === this.partialText) return;
    if (text.startsWith(this.partialText)) {
      const delta = text.slice(this.partialText.length);
      if (delta) this.session.onTranscript?.({ type: "delta", text: delta });
    }
    this.partialText = text;
  }

  private fail(error: Error): void {
    this.rejectConnected?.(error);
    this.rejectCommit?.(error);
    this.resolveConnected = undefined;
    this.rejectConnected = undefined;
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

function deepgramFluxURL(options: DeepgramFluxConfig): string {
  const url = new URL(websocketURL(options.baseURL, "/v2/listen"));
  url.searchParams.set("model", options.model);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(options.sampleRate));
  for (const language of options.languageHints ?? []) {
    url.searchParams.append("language_hint", language);
  }
  if (options.endOfTurnThreshold !== undefined) {
    url.searchParams.set("eot_threshold", String(options.endOfTurnThreshold));
  }
  if (options.eagerEndOfTurnThreshold !== undefined) {
    url.searchParams.set(
      "eager_eot_threshold",
      String(options.eagerEndOfTurnThreshold),
    );
  }
  if (options.endOfTurnTimeoutMs !== undefined) {
    url.searchParams.set("eot_timeout_ms", String(options.endOfTurnTimeoutMs));
  }
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function languagesFrom(event: Record<string, unknown>): { languages?: string[] } {
  if (!Array.isArray(event.languages)) return {};
  const languages = event.languages.filter(
    (language): language is string => typeof language === "string",
  );
  return languages.length ? { languages } : {};
}

function providerMessage(event: Record<string, unknown>, fallback: string): string {
  if (typeof event.message === "string") return event.message;
  if (typeof event.description === "string") return event.description;
  return fallback;
}

function toError(value: unknown, fallback = "Deepgram Flux transcription failed"): Error {
  return value instanceof Error ? value : new Error(fallback);
}
