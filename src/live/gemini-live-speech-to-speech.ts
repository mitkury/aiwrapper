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
  LiveImageInput,
  LiveTextOptions,
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import { createObservableSpeechToSpeechSession } from "./session-events.js";
import type { ToolRequest } from "../lang/messages.js";
import type { LangToolExecutionResult } from "../lang/tool-execution.js";
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
  wasClean?: unknown;
};

/** Gemini setup controls, kept at the provider edge. Reconnection belongs to the caller. */
export type GeminiLiveSessionConfig = {
  sessionResumption?: { handle?: string };
  contextWindowCompression?: { triggerTokens?: string; slidingWindow?: { targetTokens?: string } };
  realtimeInputConfig?: {
    automaticActivityDetection?: {
      disabled?: false;
      startOfSpeechSensitivity?: "START_SENSITIVITY_HIGH" | "START_SENSITIVITY_LOW";
      endOfSpeechSensitivity?: "END_SENSITIVITY_HIGH" | "END_SENSITIVITY_LOW";
      prefixPaddingMs?: number;
      silenceDurationMs?: number;
    };
    activityHandling?: "START_OF_ACTIVITY_INTERRUPTS" | "NO_INTERRUPTION";
    turnCoverage?: "TURN_INCLUDES_ONLY_ACTIVITY" | "TURN_INCLUDES_ALL_INPUT" | "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO";
  };
  mediaResolution?: "MEDIA_RESOLUTION_LOW" | "MEDIA_RESOLUTION_MEDIUM" | "MEDIA_RESOLUTION_HIGH";
  toolBehavior?: "BLOCKING" | "NON_BLOCKING";
};

export type GeminiLiveSpeechToSpeechOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  createWebSocket?: RealtimeSpeechWebSocketFactory;
  config?: GeminiLiveSessionConfig;
  /** Bounds both socket creation and the setup acknowledgement. Defaults to 10 seconds. */
  connectTimeoutMs?: number;
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
    if (options.connectTimeoutMs !== undefined &&
      (!Number.isFinite(options.connectTimeoutMs) || options.connectTimeoutMs <= 0)) {
      throw new Error("Gemini Live connectTimeoutMs must be positive and finite");
    }
    if (options.config?.realtimeInputConfig?.automaticActivityDetection?.disabled) {
      throw new Error("Gemini Live currently requires automatic activity detection");
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
    }, true);
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
  private readonly canceledToolCallIds = new Set<string>();
  private readonly toolControllers = new Map<string, AbortController>();
  private resolveConfigured?: () => void;
  private rejectConfigured?: (error: Error) => void;

  private readonly onOpen = (): void => {
    if (this.setupSent) return;
    try {
      const tools = speechToSpeechFunctionDeclarations(this.session, true);
      const config = this.provider.config;
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
            ...(config?.mediaResolution ? { mediaResolution: config.mediaResolution } : {}),
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
          ...(config?.sessionResumption ? { sessionResumption: config.sessionResumption } : {}),
          ...(config?.contextWindowCompression ? { contextWindowCompression: config.contextWindowCompression } : {}),
          ...(config?.realtimeInputConfig ? { realtimeInputConfig: config.realtimeInputConfig } : {}),
          ...(tools.length
            ? { tools: [{ functionDeclarations: tools.map(({ parameters, ...tool }) => ({
                ...tool,
                parametersJsonSchema: parameters,
                ...(config?.toolBehavior ? { behavior: config.toolBehavior } : {}),
              })) }] }
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
    const wasOpen = this.state === "open";
    const error = geminiCloseError(event);
    this.terminate(error);
    if (wasOpen) this.session.onEvent?.({
      type: "connection-closed",
      ...(typeof event.code === "number" ? { code: event.code } : {}),
      ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
      ...(typeof event.wasClean === "boolean" ? { wasClean: event.wasClean } : {}),
    });
    if (wasOpen) this.session.onEvent?.({ type: "error", error });
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
    const configured = new Promise<void>((resolve, reject) => {
      this.resolveConfigured = resolve;
      this.rejectConfigured = reject;
    });
    const timer = setTimeout(() => this.fail(new Error(
      "Gemini Live connection timed out before setup was acknowledged",
    )), this.provider.connectTimeoutMs ?? 10_000);
    void this.openSocket().catch((error) => this.fail(toError(error)));
    try {
      await configured;
    } finally {
      clearTimeout(timer);
    }
  }

  private async openSocket(): Promise<void> {
    const socket = await this.provider.createWebSocket(
      geminiLiveURL(this.provider.baseURL, this.provider.apiKey),
      { ...this.provider.headers },
    );
    if (this.state === "closed" || this.controller.signal.aborted) {
      socket.close();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", this.onOpen);
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("error", this.onError);
    socket.addEventListener("close", this.onClose);

    if (socket.readyState === 1) {
      this.onOpen();
    } else if (socket.readyState !== 0) {
      this.fail(new Error("Gemini Live speech-to-speech connection closed during setup"));
    }
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
    if (this.state === "open" && this.socket?.readyState === 1 &&
      !this.provider.config?.realtimeInputConfig?.automaticActivityDetection?.disabled) {
      try {
        this.send({ realtimeInput: { audioStreamEnd: true } });
      } catch {
        // Closing the socket is sufficient when the stream-end message fails.
      }
    }
    this.terminate(createAbortError());
  }

  async endAudio(): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    this.send({ realtimeInput: { audioStreamEnd: true } });
  }

  private terminate(error: Error): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.rejectConfigured?.(error);
    this.resolveConfigured = undefined;
    this.rejectConfigured = undefined;
    this.controller.abort();
    this.seenToolCallIds.clear();
    this.canceledToolCallIds.clear();
    this.unlinkAbort();
    this.cleanupSocket();
    this.socket?.close();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await socketDataToText(data);
    if (this.state === "closed") return;
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
    }

    const resumption = message.sessionResumptionUpdate as
      { resumable?: unknown; newHandle?: unknown } | undefined;
    if (resumption) this.session.onEvent?.({
      type: "session-resumption",
      resumable: resumption.resumable === true,
      ...(resumption.resumable === true && typeof resumption.newHandle === "string" && resumption.newHandle
        ? { handle: resumption.newHandle } : {}),
    });
    const goAway = message.goAway as { timeLeft?: unknown } | undefined;
    if (goAway) {
      const timeLeftMs = durationMilliseconds(goAway.timeLeft);
      this.session.onEvent?.({ type: "connection-expiring", ...(timeLeftMs !== undefined ? { timeLeftMs } : {}) });
    }
    const cancellation = message.toolCallCancellation as { ids?: unknown } | undefined;
    if (Array.isArray(cancellation?.ids)) {
      const callIds = cancellation.ids.filter((id): id is string => typeof id === "string" && Boolean(id));
      for (const id of callIds) {
        this.canceledToolCallIds.add(id);
        this.toolControllers.get(id)?.abort();
      }
      if (callIds.length) this.session.onEvent?.({ type: "tool-calls-canceled", callIds });
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
        if (!parsed || this.canceledToolCallIds.has(parsed.callId)) return [];
        // Manual callers own replay/deduplication across connection rotations.
        if (this.session.toolHandling !== "manual") {
          if (this.seenToolCallIds.has(parsed.callId)) return [];
          this.seenToolCallIds.add(parsed.callId);
        }
        return [parsed];
      });
      if (this.session.toolHandling === "manual") {
        for (const call of calls) this.session.onEvent?.({ type: "tool-call", call });
      } else {
        void this.completeToolCalls(calls).catch((error) => this.fail(toError(error)));
      }
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

    if (content.interrupted === true) {
      // Notify even for a tool-only turn so applications clear pending playback.
      this.session.onEvent?.({ type: "response-interrupted" });
      this.responseActive = false;
    }

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
      const partText = Reflect.get(part, "text");
      if (typeof partText === "string" && partText && Reflect.get(part, "thought") !== true) {
        this.ensureResponseStarted();
        this.session.onEvent?.({ type: "output-transcript", transcript: { type: "delta", text: partText }, source: "text" });
      }
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

    if (content.turnComplete === true) {
      this.session.onEvent?.({ type: "response-end" });
      this.responseActive = false;
      // Keep in-flight IDs across turn markers; a replay must not execute twice.
      for (const id of this.seenToolCallIds) {
        if (!this.toolControllers.has(id)) this.seenToolCallIds.delete(id);
      }
    }
  }

  private async completeToolCalls(calls: ToolRequest[]): Promise<void> {
    const results = await Promise.all(calls.map(async (call) => {
      const controller = new AbortController();
      const unlink = linkAbortSignal(this.controller.signal, controller);
      this.toolControllers.set(call.callId, controller);
      let onAbort: () => void = () => {};
      try {
        const canceled = new Promise<undefined>((resolve) => {
          onAbort = () => resolve(undefined);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          if (controller.signal.aborted) onAbort();
        });
        return await Promise.race([
          executeSpeechToSpeechToolCall(this.session, call, controller.signal),
          canceled,
        ]);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        return undefined;
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
        unlink();
        this.toolControllers.delete(call.callId);
      }
    }));
    if (this.state === "closed") return;
    this.writeToolResults(results.filter((result): result is LangToolExecutionResult => Boolean(result)), true);
  }

  async sendText(text: string, options: LiveTextOptions = {}): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (options.realtime) {
      if (options.role === "assistant" || options.turnComplete !== undefined) {
        throw new Error("Realtime text uses user activity detection, not a role or turnComplete setting");
      }
      this.send({ realtimeInput: { text } });
      return;
    }
    this.send({ clientContent: {
      turns: [{ role: options.role === "assistant" ? "model" : "user", parts: [{ text }] }],
      turnComplete: options.turnComplete ?? true,
    } });
  }

  async appendImage(image: LiveImageInput): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (!image.data || image.data.startsWith("data:") || !["image/jpeg", "image/png"].includes(image.mimeType)) {
      throw new Error("Gemini Live images require base64 bytes and an image/jpeg or image/png MIME type");
    }
    this.send({ realtimeInput: { video: { data: image.data, mimeType: image.mimeType } } });
  }

  async sendToolResults(results: LangToolExecutionResult[]): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    if (this.session.toolHandling !== "manual") {
      throw new Error("sendToolResults requires manual tool handling");
    }
    this.writeToolResults(results);
  }

  private writeToolResults(results: LangToolExecutionResult[], automatic = false): void {
    const active = results.filter((result) => !this.canceledToolCallIds.has(result.callId));
    if (!active.length) return;
    this.send({
      toolResponse: {
        functionResponses: active.map((result) => ({
          id: result.callId,
          name: result.name,
          response: automatic ? { result: jsonSpeechToSpeechToolResult(result.result) } : toolResponseObject(result.result),
        })),
      },
    });
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
    this.terminate(error);
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

function toolResponseObject(value: unknown): Record<string, unknown> {
  const result = jsonSpeechToSpeechToolResult(value);
  return result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : { result };
}

function durationMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+(\.\d+)?s$/.test(value)) return undefined;
  const milliseconds = Number(value.slice(0, -1)) * 1000;
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
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
