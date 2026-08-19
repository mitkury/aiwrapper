import {
  assertPcmFrame,
  createAbortError,
  decodeBase64Pcm,
  encodePcmAsBase64,
  linkAbortSignal,
  throwIfAborted,
} from "../speech/audio.js";
import type { PcmAudioFormat, PcmAudioFrame } from "../speech/types.js";
import {
  createNodeWebSocket,
  socketDataToText,
  websocketURL,
  type RealtimeSpeechWebSocket,
  type RealtimeSpeechWebSocketFactory,
} from "../speech/realtime-websocket.js";
import type {
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import { createObservableSpeechToSpeechSession } from "./session-events.js";
import {
  executeSpeechToSpeechToolCall,
  jsonSpeechToSpeechToolResult,
  parseSpeechToSpeechToolCall,
  speechToSpeechFunctionDeclarations,
} from "./live-lang-tools.js";

type SocketEvent = {
  data?: unknown;
  error?: unknown;
  code?: unknown;
  reason?: unknown;
};

export type GeminiLiveSpeechToSpeechOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  createWebSocket?: RealtimeSpeechWebSocketFactory;
};

type GeminiLiveSpeechToSpeechConfig = Required<
  Pick<
    GeminiLiveSpeechToSpeechOptions,
    "apiKey" | "model" | "voice" | "baseURL" | "createWebSocket"
  >
> &
  Omit<
    GeminiLiveSpeechToSpeechOptions,
    "apiKey" | "model" | "voice" | "baseURL" | "createWebSocket"
  >;

const inputPcm: PcmAudioFormat = {
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate: 16000,
};

const outputPcm: PcmAudioFormat = {
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate: 24000,
};

export class GeminiLiveSpeechToSpeech implements SpeechToSpeechProvider {
  readonly inputFormat = inputPcm;
  readonly outputFormat = outputPcm;
  private readonly options: GeminiLiveSpeechToSpeechConfig;

  constructor(options: GeminiLiveSpeechToSpeechOptions) {
    if (!options.apiKey) {
      throw new Error("Gemini Live speech-to-speech requires an API key");
    }
    this.options = {
      ...options,
      model: options.model ?? "gemini-3.1-flash-live-preview",
      voice: options.voice ?? "Kore",
      baseURL: options.baseURL ?? "https://generativelanguage.googleapis.com",
      createWebSocket: options.createWebSocket ?? createNodeWebSocket,
    };
  }

  async createSession(
    options: SpeechToSpeechSessionOptions = {},
  ): Promise<SpeechToSpeechSession> {
    return createObservableSpeechToSpeechSession(options, async (events) => {
      const session = new GeminiLiveSpeechToSpeechSession(this.options, events);
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

class GeminiLiveSpeechToSpeechSession {
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private socket?: RealtimeSpeechWebSocket;
  private state: "connecting" | "open" | "closed" = "connecting";
  private setupSent = false;
  private responseActive = false;
  private messageTask: Promise<void> = Promise.resolve();
  private readonly seenToolCallIds = new Set<string>();
  private resolveConfigured?: () => void;
  private rejectConfigured?: (error: Error) => void;

  private readonly onOpen = (): void => {
    if (this.setupSent) return;
    try {
      const tools = speechToSpeechFunctionDeclarations(this.session);
      this.send({
        setup: {
          model: modelResourceName(this.provider.model),
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.provider.voice },
              },
            },
          },
          ...(this.session.instructions
            ? {
                systemInstruction: {
                  parts: [{ text: this.session.instructions }],
                },
              }
            : {}),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          ...(tools.length
            ? { tools: [{ functionDeclarations: tools }] }
            : {}),
        },
      });
      this.setupSent = true;
    } catch (error) {
      this.fail(toError(error));
    }
  };

  private readonly onMessage = (event: SocketEvent): void => {
    this.messageTask = this.messageTask
      .then(() => this.handleMessage(event.data))
      .catch((error) => this.fail(toError(error)));
  };

  private readonly onError = (event: SocketEvent): void => {
    this.fail(toError(event.error, "Gemini Live speech-to-speech failed"));
  };

  private readonly onClose = (event: SocketEvent): void => {
    if (this.state === "closed") return;
    this.fail(geminiCloseError(event));
  };

  constructor(
    private readonly provider: GeminiLiveSpeechToSpeechConfig,
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
      geminiLiveURL(this.provider.baseURL, this.provider.apiKey),
      { ...this.provider.headers },
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
            "Gemini Live speech-to-speech connection closed during setup",
          ),
        );
      }
    });
  }

  async appendAudio(frame: PcmAudioFrame): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    assertPcmFrame(frame);
    if (frame.sampleRate !== inputPcm.sampleRate) {
      throw new Error(
        `Gemini Live speech-to-speech requires ${inputPcm.sampleRate} Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }
    if (frame.samples.length === 0) return;
    this.send({
      realtimeInput: {
        audio: {
          data: encodePcmAsBase64(frame.samples),
          mimeType: `audio/pcm;rate=${inputPcm.sampleRate}`,
        },
      },
    });
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "open" && this.socket?.readyState === 1) {
      try {
        this.send({ realtimeInput: { audioStreamEnd: true } });
      } catch {
        // Closing the socket is sufficient when the stream-end message fails.
      }
    }
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
    const message = JSON.parse(text) as Record<string, unknown>;
    const providerError = message.error as { message?: unknown } | undefined;
    if (providerError) {
      this.fail(
        new Error(
          typeof providerError.message === "string"
            ? providerError.message
            : "Gemini Live returned an error",
        ),
      );
      return;
    }
    if (message.setupComplete !== undefined) {
      this.state = "open";
      this.resolveConfigured?.();
      this.resolveConfigured = undefined;
      this.rejectConfigured = undefined;
      return;
    }

    const toolCall = message.toolCall as
      | { functionCalls?: unknown }
      | undefined;
    if (Array.isArray(toolCall?.functionCalls)) {
      const calls = toolCall.functionCalls.flatMap((value) => {
        const call = value && typeof value === "object"
          ? value as Record<string, unknown>
          : undefined;
        const parsed = call
          ? parseSpeechToSpeechToolCall(call.id, call.name, call.args)
          : undefined;
        if (!parsed || this.seenToolCallIds.has(parsed.callId)) return [];
        this.seenToolCallIds.add(parsed.callId);
        return [parsed];
      });
      const results = await Promise.all(
        calls.map((call) =>
          executeSpeechToSpeechToolCall(
            this.session,
            call,
            this.controller.signal,
          )
        ),
      );
      if (results.length) {
        this.send({
          toolResponse: {
            functionResponses: results.map((result) => ({
              id: result.callId,
              name: result.name,
              response: {
                result: jsonSpeechToSpeechToolResult(result.result),
              },
            })),
          },
        });
      }
      return;
    }

    const content = message.serverContent as
      | {
          modelTurn?: { parts?: unknown[] };
          inputTranscription?: { text?: unknown };
          outputTranscription?: { text?: unknown };
          turnComplete?: unknown;
          interrupted?: unknown;
        }
      | undefined;
    if (!content) return;

    const inputText = content.inputTranscription?.text;
    if (typeof inputText === "string" && inputText) {
      this.session.onEvent?.({
        type: "input-transcript",
        transcript: { type: "delta", text: inputText },
      });
    }
    const outputText = content.outputTranscription?.text;
    if (typeof outputText === "string" && outputText) {
      this.ensureResponseStarted();
      this.session.onEvent?.({
        type: "output-transcript",
        transcript: { type: "delta", text: outputText },
      });
    }

    for (const part of content.modelTurn?.parts ?? []) {
      if (!part || typeof part !== "object") continue;
      const inlineData = Reflect.get(part, "inlineData") as
        { data?: unknown } | undefined;
      if (typeof inlineData?.data !== "string" || !inlineData.data) continue;
      this.ensureResponseStarted();
      this.session.onEvent?.({
        type: "output-audio",
        frame: {
          ...outputPcm,
          samples: decodeBase64Pcm(inlineData.data, "Gemini Live"),
        },
      });
    }

    if (content.interrupted === true) {
      if (this.responseActive) {
        this.session.onEvent?.({ type: "response-interrupted" });
      }
      this.responseActive = false;
      this.seenToolCallIds.clear();
      return;
    }
    if (content.turnComplete === true) {
      if (this.responseActive) {
        this.session.onEvent?.({ type: "response-end" });
      }
      this.responseActive = false;
      this.seenToolCallIds.clear();
    }
  }

  private ensureResponseStarted(): void {
    if (this.responseActive) return;
    this.responseActive = true;
    this.session.onEvent?.({ type: "response-start" });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("Gemini Live speech-to-speech connection is not open");
    }
    this.socket.send(JSON.stringify(message));
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
        this.session.onEvent?.({ type: "error", error });
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

function modelResourceName(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function geminiLiveURL(baseURL: string, apiKey: string): string {
  const path =
    "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  return `${websocketURL(baseURL, path)}?key=${encodeURIComponent(apiKey)}`;
}

function geminiCloseError(event: SocketEvent): Error {
  const code = typeof event.code === "number" ? String(event.code) : "";
  const reason = typeof event.reason === "string" ? event.reason.trim() : "";
  const details = [code, reason].filter(Boolean).join(": ");
  return new Error(
    `Gemini Live speech-to-speech connection closed${details ? ` (${details})` : ""}`,
  );
}

function toError(
  value: unknown,
  fallback = "Gemini Live speech-to-speech failed",
): Error {
  return value instanceof Error ? value : new Error(fallback);
}
