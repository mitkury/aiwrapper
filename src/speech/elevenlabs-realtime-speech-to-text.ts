import {
  assertPcmFrame,
  createAbortError,
  encodePcmAsBase64,
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

export type ElevenLabsRealtimeSpeechToTextOptions = {
  apiKey: string;
  model?: string;
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  baseURL?: string;
  languageCode?: string;
  secondaryLanguages?: string[];
  commitStrategy?: "manual" | "vad";
  vadSilenceThresholdSeconds?: number;
  vadThreshold?: number;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

type ElevenLabsRealtimeConfig = Required<Pick<
  ElevenLabsRealtimeSpeechToTextOptions,
  "apiKey" | "model" | "sampleRate" | "baseURL" | "commitStrategy" | "createWebSocket"
>> & Omit<
  ElevenLabsRealtimeSpeechToTextOptions,
  "apiKey" | "model" | "sampleRate" | "baseURL" | "commitStrategy" | "createWebSocket"
>;

export class ElevenLabsRealtimeSpeechToText implements SpeechToTextProvider {
  readonly inputFormat;
  private readonly options: ElevenLabsRealtimeConfig;

  constructor(options: ElevenLabsRealtimeSpeechToTextOptions) {
    if (!options.apiKey) {
      throw new Error("ElevenLabs realtime speech-to-text requires an API key");
    }
    this.options = {
      ...options,
      model: options.model ?? "scribe_v2_realtime",
      sampleRate: options.sampleRate ?? 24000,
      baseURL: options.baseURL ?? "https://api.elevenlabs.io/v1",
      commitStrategy: options.commitStrategy ?? "vad",
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
    const session = new ElevenLabsRealtimeSpeechToTextSession(this.options, options);
    try {
      await session.connect();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
}

class ElevenLabsRealtimeSpeechToTextSession implements SpeechToTextSession {
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private socket?: RealtimeSpeechWebSocket;
  private state: "connecting" | "open" | "closed" = "connecting";
  private uncommittedAudioBytes = 0;
  private pendingManualAudio?: string;
  private partialText = "";
  private speechActive = false;
  private resolveConnected?: () => void;
  private rejectConnected?: (error: Error) => void;
  private resolveCommit?: (result: TranscriptionResult) => void;
  private rejectCommit?: (error: Error) => void;

  private readonly onMessage = (event: SocketEvent): void => {
    void this.handleMessage(event.data).catch(error => this.fail(toError(error)));
  };
  private readonly onError = (event: SocketEvent): void => {
    this.fail(toError(event.error, "ElevenLabs realtime transcription failed"));
  };
  private readonly onClose = (): void => {
    if (this.state === "closed") return;
    this.fail(new Error("ElevenLabs realtime transcription connection closed"));
  };

  constructor(
    private readonly provider: ElevenLabsRealtimeConfig,
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
      elevenLabsRealtimeURL(this.provider),
      {
        "xi-api-key": this.provider.apiKey,
        ...this.provider.headers,
      },
    );
    this.socket = socket;
    if (this.controller.signal.aborted) {
      socket.close();
      throw createAbortError();
    }
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("error", this.onError);
    socket.addEventListener("close", this.onClose);

    await new Promise<void>((resolve, reject) => {
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
      if (socket.readyState !== 0 && socket.readyState !== 1) {
        reject(new Error(
          "ElevenLabs realtime transcription connection closed during setup",
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
        `ElevenLabs realtime transcription requires ${this.provider.sampleRate} Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }
    if (frame.samples.length === 0) return;
    const audio = encodePcmAsBase64(frame.samples);
    if (this.provider.commitStrategy === "manual") {
      if (this.pendingManualAudio) {
        this.send({
          message_type: "input_audio_chunk",
          audio_base_64: this.pendingManualAudio,
        });
      }
      this.pendingManualAudio = audio;
    } else {
      this.send({
        message_type: "input_audio_chunk",
        audio_base_64: audio,
      });
    }
    this.uncommittedAudioBytes += frame.samples.byteLength;
  }

  async commit(): Promise<TranscriptionResult> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (this.uncommittedAudioBytes === 0) {
      throw new Error("Cannot transcribe an empty audio turn");
    }
    if (this.resolveCommit) throw new Error("A transcript commit is already pending");
    const manualAudio = this.provider.commitStrategy === "manual"
      ? this.pendingManualAudio
      : undefined;
    if (this.provider.commitStrategy === "manual" && !manualAudio) {
      throw new Error("Cannot commit ElevenLabs audio without a pending chunk");
    }
    const result = new Promise<TranscriptionResult>((resolve, reject) => {
      this.resolveCommit = resolve;
      this.rejectCommit = reject;
    });
    if (this.provider.commitStrategy === "manual") {
      this.send({
        message_type: "input_audio_chunk",
        audio_base_64: manualAudio,
        commit: true,
      });
      this.pendingManualAudio = undefined;
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
    this.rejectConnected?.(createAbortError());
    this.rejectCommit?.(createAbortError());
    this.cleanupSocket();
    this.socket?.close();
    this.unlinkAbort();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const event = JSON.parse(await socketDataToText(data)) as Record<string, unknown>;
    const type = typeof event.message_type === "string" ? event.message_type : "";
    const text = typeof event.text === "string" ? event.text : "";

    if (type === "session_started") {
      this.state = "open";
      this.resolveConnected?.();
      this.resolveConnected = undefined;
      this.rejectConnected = undefined;
      return;
    }
    if (type === "partial_transcript" || type === "final_transcript") {
      if (text && !this.speechActive) {
        this.speechActive = true;
        this.session.onSpeechActivity?.({ type: "start" });
      }
      this.emitPartial(text);
      return;
    }
    if (type === "committed_transcript" || type === "committed_transcript_with_timestamps") {
      const result = {
        text,
        ...languageFrom(event),
      };
      this.session.onSpeechActivity?.({ type: "end" });
      this.session.onTranscript?.({ type: "final", ...result });
      this.speechActive = false;
      this.partialText = "";
      this.uncommittedAudioBytes = 0;
      this.pendingManualAudio = undefined;
      const resolve = this.resolveCommit;
      this.resolveCommit = undefined;
      this.rejectCommit = undefined;
      resolve?.(result);
      return;
    }
    if (type && (type.includes("error") || type === "rate_limited")) {
      this.fail(new Error(providerMessage(event, "ElevenLabs realtime transcription returned an error")));
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

  private send(event: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("ElevenLabs realtime transcription connection is not open");
    }
    this.socket.send(JSON.stringify(event));
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
    this.socket?.removeEventListener("message", this.onMessage);
    this.socket?.removeEventListener("error", this.onError);
    this.socket?.removeEventListener("close", this.onClose);
  }
}

function elevenLabsRealtimeURL(options: ElevenLabsRealtimeConfig): string {
  const url = new URL(websocketURL(options.baseURL, "/speech-to-text/realtime"));
  url.searchParams.set("model_id", options.model);
  url.searchParams.set("audio_format", `pcm_${options.sampleRate}`);
  url.searchParams.set("commit_strategy", options.commitStrategy);
  if (options.languageCode) url.searchParams.set("language_code", options.languageCode);
  for (const language of options.secondaryLanguages ?? []) {
    url.searchParams.append("secondary_languages", language);
  }
  if (options.vadSilenceThresholdSeconds !== undefined) {
    url.searchParams.set(
      "vad_silence_threshold_secs",
      String(options.vadSilenceThresholdSeconds),
    );
  }
  if (options.vadThreshold !== undefined) {
    url.searchParams.set("vad_threshold", String(options.vadThreshold));
  }
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function languageFrom(event: Record<string, unknown>): { languages?: string[] } {
  const language = typeof event.language_code === "string"
    ? event.language_code
    : undefined;
  return language ? { languages: [language] } : {};
}

function providerMessage(event: Record<string, unknown>, fallback: string): string {
  if (typeof event.error === "string") return event.error;
  if (typeof event.message === "string") return event.message;
  return fallback;
}

function toError(value: unknown, fallback = "ElevenLabs realtime transcription failed"): Error {
  return value instanceof Error ? value : new Error(fallback);
}
