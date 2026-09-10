import { httpRequestWithRetry as fetch } from "../http-request.js";
import {
  createAbortError,
  decodeBase64,
  responsePcmFrames,
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
  PcmAudioFormat,
  PcmAudioFrame,
  StreamingTextToSpeechSession,
  TextToSpeechOptions,
  TextToSpeechProvider,
} from "./types.js";

export type ElevenLabsPcmSampleRate =
  8000 | 16000 | 22050 | 24000 | 44100 | 48000;

export type ElevenLabsVoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
};

export type ElevenLabsTextToSpeechOptions = {
  apiKey?: string;
  singleUseToken?: string;
  voiceId: string;
  model?: string;
  sampleRate?: ElevenLabsPcmSampleRate;
  baseURL?: string;
  languageCode?: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  headers?: Record<string, string>;
  bodyProperties?: Record<string, unknown>;
  chunkLengthSchedule?: number[];
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

export class ElevenLabsTextToSpeech implements TextToSpeechProvider {
  readonly outputFormat: PcmAudioFormat;
  private readonly model: string;
  private readonly baseURL: string;

  constructor(private readonly options: ElevenLabsTextToSpeechOptions) {
    if (!options.apiKey && !options.singleUseToken) {
      throw new Error(
        "ElevenLabs text-to-speech requires an API key or single-use token",
      );
    }
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
    if (!this.options.apiKey) {
      throw new Error("ElevenLabs HTTP text-to-speech requires an API key");
    }
    throwIfAborted(options.signal);

    const voiceId = options.voice?.trim() || this.options.voiceId.trim();
    const url = new URL(
      `${this.baseURL}/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    );
    url.searchParams.set(
      "output_format",
      `pcm_${this.outputFormat.sampleRate}`,
    );

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

  async createStreamingSession(
    options: TextToSpeechOptions = {},
  ): Promise<StreamingTextToSpeechSession> {
    throwIfAborted(options.signal);
    const voiceId = options.voice?.trim() || this.options.voiceId.trim();
    const url = new URL(
      websocketURL(
        this.baseURL,
        `/text-to-speech/${encodeURIComponent(voiceId)}/stream-input`,
      ),
    );
    url.searchParams.set("model_id", this.model);
    url.searchParams.set(
      "output_format",
      `pcm_${this.outputFormat.sampleRate}`,
    );
    if (this.options.singleUseToken) {
      url.searchParams.set("single_use_token", this.options.singleUseToken);
    }

    const createWebSocket = this.options.createWebSocket ?? createNodeWebSocket;
    const socket = await createWebSocket(
      url.toString(),
      this.options.apiKey ? { "xi-api-key": this.options.apiKey } : {},
    );
    await waitForOpen(socket, options.signal);
    const session = new ElevenLabsStreamingTextToSpeechSession(
      socket,
      this.outputFormat,
      options.signal,
    );
    socket.send(
      JSON.stringify({
        text: " ",
        ...(this.options.voiceSettings
          ? { voice_settings: this.options.voiceSettings }
          : {}),
        ...(this.options.chunkLengthSchedule
          ? {
              generation_config: {
                chunk_length_schedule: this.options.chunkLengthSchedule,
              },
            }
          : {}),
      }),
    );
    return session;
  }
}

type ElevenLabsStreamMessage = {
  audio?: string;
  isFinal?: boolean;
  is_final?: boolean;
  error?: string;
  message?: string;
};

class ElevenLabsStreamingTextToSpeechSession implements StreamingTextToSpeechSession {
  private readonly frames = new AsyncFrameQueue();
  private carry: number | undefined;
  private inputEnded = false;
  private closed = false;
  private finalized = false;
  private readonly onMessage = (event: { data?: unknown }) => {
    void this.handleMessage(event.data).catch((error) => this.fail(error));
  };
  private readonly onError = () =>
    this.fail(new Error("ElevenLabs text-to-speech WebSocket failed"));
  private readonly onClose = () => {
    if (!this.closed && !this.finalized) {
      this.fail(
        new Error(
          "ElevenLabs text-to-speech WebSocket closed before completion",
        ),
      );
    }
  };
  private readonly onAbort = () => this.fail(createAbortError());

  constructor(
    private readonly socket: RealtimeSpeechWebSocket,
    private readonly format: PcmAudioFormat,
    private readonly signal?: AbortSignal,
  ) {
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("error", this.onError);
    socket.addEventListener("close", this.onClose);
    signal?.addEventListener("abort", this.onAbort, { once: true });
  }

  appendText(text: string): void {
    if (this.inputEnded) throw new Error("Text-to-speech input has ended");
    if (this.closed) throw new Error("Text-to-speech session is closed");
    if (!text) return;
    throwIfAborted(this.signal);
    this.socket.send(JSON.stringify({ text }));
  }

  flush(): void {
    if (this.inputEnded) throw new Error("Text-to-speech input has ended");
    if (this.closed) throw new Error("Text-to-speech session is closed");
    throwIfAborted(this.signal);
    this.socket.send(JSON.stringify({ text: " ", flush: true }));
  }

  endInput(): void {
    if (this.inputEnded || this.closed) return;
    throwIfAborted(this.signal);
    this.inputEnded = true;
    this.socket.send(JSON.stringify({ text: "" }));
  }

  [Symbol.asyncIterator](): AsyncIterator<PcmAudioFrame> {
    return this.frames;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.socket.close();
    this.frames.end();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const message = JSON.parse(
      await socketDataToText(data),
    ) as ElevenLabsStreamMessage;
    if (message.error) throw new Error(message.message || message.error);
    if (message.audio) this.enqueuePcm(decodeBase64(message.audio));
    if (message.isFinal || message.is_final) {
      if (this.carry !== undefined) {
        throw new Error("ElevenLabs returned an incomplete PCM sample");
      }
      this.finalized = true;
      this.frames.end();
    }
  }

  private enqueuePcm(bytes: Uint8Array): void {
    const combined = new Uint8Array(
      bytes.length + (this.carry === undefined ? 0 : 1),
    );
    let offset = 0;
    if (this.carry !== undefined) combined[offset++] = this.carry;
    combined.set(bytes, offset);
    const usable = combined.length - (combined.length % 2);
    this.carry =
      usable < combined.length ? combined[combined.length - 1] : undefined;
    if (!usable) return;
    const view = new DataView(combined.buffer, combined.byteOffset, usable);
    const samples = new Int16Array(usable / 2);
    for (let index = 0; index < samples.length; index++) {
      samples[index] = view.getInt16(index * 2, true);
    }
    this.frames.push({ ...this.format, samples });
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.socket.close();
    this.frames.fail(error instanceof Error ? error : new Error(String(error)));
  }

  private detach(): void {
    this.socket.removeEventListener("message", this.onMessage);
    this.socket.removeEventListener("error", this.onError);
    this.socket.removeEventListener("close", this.onClose);
    this.signal?.removeEventListener("abort", this.onAbort);
  }
}

class AsyncFrameQueue implements AsyncIterator<PcmAudioFrame> {
  private readonly values: PcmAudioFrame[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<PcmAudioFrame>) => void;
    reject: (error: Error) => void;
  }> = [];
  private finished = false;
  private error?: Error;

  next(): Promise<IteratorResult<PcmAudioFrame>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (this.error) return Promise.reject(this.error);
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }

  push(value: PcmAudioFrame): void {
    if (this.finished || this.error) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    if (this.finished || this.error) return;
    this.finished = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: Error): void {
    if (this.finished || this.error) return;
    this.error = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

function waitForOpen(
  socket: RealtimeSpeechWebSocket,
  signal?: AbortSignal,
): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve();
  if (signal?.aborted) {
    socket.close();
    return Promise.reject(createAbortError());
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void) => {
      cleanup();
      action();
    };
    const onOpen = () => finish(resolve);
    const onError = () =>
      finish(() =>
        reject(new Error("Could not connect to ElevenLabs text-to-speech")),
      );
    const onClose = () =>
      finish(() =>
        reject(
          new Error(
            "ElevenLabs text-to-speech WebSocket closed while connecting",
          ),
        ),
      );
    const onAbort = () =>
      finish(() => {
        socket.close();
        reject(createAbortError());
      });
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
