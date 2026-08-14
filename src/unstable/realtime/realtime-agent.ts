import { Agent } from "../../agents/agent.js";
import { ChatAgent } from "../../agents/ChatAgent.js";
import type { LanguageProvider } from "../../lang/language-provider.js";
import {
  LangMessage,
  type LangContentImage,
  type LangMessageItem,
  type LangMessageItemImage,
  type LangMessages,
  type LangTool,
} from "../../lang/messages.js";
import { isAbortError, normalizeError } from "../../errors.js";
import type {
  PcmAudioFrame,
  SpeechToTextProvider,
  SpeechToTextSession,
  TextToSpeechProvider,
  TranscriptEvent,
} from "../speech/types.js";
import {
  StreamingTextSegmenter,
  type StreamingTextSegmenterOptions,
} from "./text-segmenter.js";
import type { RealtimeAgentEvent } from "./types.js";

export type RealtimeAgentOptions = {
  speechToText: SpeechToTextProvider;
  textToSpeech: TextToSpeechProvider;
  instructions?: string;
  tools?: LangTool[];
  maxIterations?: number;
  textSegmenter?: StreamingTextSegmenterOptions;
};

type InterruptedReason = Extract<
  RealtimeAgentEvent,
  { type: "interrupted" }
>["reason"];

export class RealtimeAgent extends Agent<void, LangMessages, RealtimeAgentEvent> {
  private readonly chatAgent: ChatAgent;
  private readonly speechToText: SpeechToTextProvider;
  private readonly textToSpeech: TextToSpeechProvider;
  private readonly segmenterOptions?: StreamingTextSegmenterOptions;
  private speechSession?: SpeechToTextSession;
  private latestImage?: LangContentImage;
  private responseController?: AbortController;
  private responseTask?: Promise<LangMessages | undefined>;
  private runCompletion?: Promise<LangMessages>;
  private resolveClosed?: () => void;
  private readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });
  private resolveConnected?: () => void;
  private rejectConnected?: (error: Error) => void;
  private readonly connected = new Promise<void>((resolve, reject) => {
    this.resolveConnected = resolve;
    this.rejectConnected = reject;
  });
  private closing = false;
  private finalTranscriptCount = 0;

  constructor(language: LanguageProvider, options: RealtimeAgentOptions) {
    super();
    this.speechToText = options.speechToText;
    this.textToSpeech = options.textToSpeech;
    this.segmenterOptions = options.textSegmenter;
    this.chatAgent = new ChatAgent(language, {
      tools: options.tools,
      maxIterations: options.maxIterations,
    });
    this.chatAgent.messages.instructions = options.instructions;
  }

  get messages(): LangMessages {
    return this.chatAgent.messages;
  }

  async connect(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.runCompletion) {
      throw new Error("RealtimeAgent has already been started");
    }
    this.runCompletion = this.run(undefined, options);
    // A connected session can later fail without close() being awaited. Agent
    // events still report that failure; this catch prevents an unhandled promise.
    void this.runCompletion.catch(() => undefined);
    await this.connected;
  }

  async sendAudio(frame: PcmAudioFrame): Promise<void> {
    if (!this.speechSession) throw new Error("RealtimeAgent is not connected");
    await this.speechSession.appendAudio(frame);
  }

  async commitAudio(): Promise<LangMessages> {
    if (!this.speechSession) throw new Error("RealtimeAgent is not connected");
    const before = this.finalTranscriptCount;
    const result = await this.speechSession.commit();
    // Providers normally invoke onTranscript before commit resolves. Keep this
    // fallback for custom providers that only return the committed transcript.
    if (result.text.trim() && this.finalTranscriptCount === before) {
      this.handleTranscript({ type: "final", ...result });
    }
    return (await this.responseTask) ?? this.messages;
  }

  async sendText(text: string): Promise<LangMessages> {
    const normalized = text.trim();
    if (!normalized) throw new Error("RealtimeAgent text input cannot be empty");
    this.emit({ type: "transcript", speaker: "user", text: normalized, final: true });
    return (await this.queueResponse(normalized)) ?? this.messages;
  }

  setImage(image: LangContentImage | undefined): void {
    this.latestImage = image;
  }

  interrupt(reason: InterruptedReason = "manual"): void {
    if (!this.responseController || this.responseController.signal.aborted) return;
    this.responseController.abort();
    this.emit({ type: "interrupted", reason });
  }

  async close(): Promise<LangMessages> {
    if (!this.runCompletion) throw new Error("RealtimeAgent has not been started");
    if (!this.closing) {
      this.closing = true;
      this.interrupt("closed");
      try {
        await this.speechSession?.close();
      } finally {
        this.resolveClosed?.();
      }
    }
    return this.runCompletion;
  }

  protected async runInternal(
    _input?: void,
    options?: { signal?: AbortSignal },
  ): Promise<LangMessages> {
    const handleAbort = () => {
      this.closing = true;
      this.interrupt("closed");
      void this.speechSession?.close();
      this.resolveClosed?.();
    };
    try {
      options?.signal?.throwIfAborted();
      options?.signal?.addEventListener("abort", handleAbort, { once: true });
      this.speechSession = await this.speechToText.createSession({
        signal: options?.signal,
        onTranscript: event => this.handleTranscript(event),
        onSpeechActivity: event => {
          const active = event.type === "start";
          this.emit({ type: "speech", speaker: "user", active });
          if (active) this.interrupt("user_speech");
        },
      });
      if (this.closing) {
        await this.speechSession.close();
        options?.signal?.throwIfAborted();
        const error = new Error("RealtimeAgent was closed while connecting");
        error.name = "AbortError";
        throw error;
      }
      this.resolveConnected?.();
      this.emit({ type: "connected" });
      await this.closed;
      if (options?.signal?.aborted) await this.speechSession.close();
      options?.signal?.throwIfAborted();
      await this.responseTask?.catch(() => undefined);
      this.emit({ type: "finished", output: this.messages });
      return this.messages;
    } catch (error) {
      this.rejectConnected?.(normalizeError(error));
      throw error;
    } finally {
      options?.signal?.removeEventListener("abort", handleAbort);
    }
  }

  private handleTranscript(event: TranscriptEvent): void {
    const final = event.type === "final";
    if (!final) {
      if (event.text) {
        this.emit({ type: "transcript", speaker: "user", text: event.text, final: false });
      }
      return;
    }
    const text = event.text.trim();
    if (!text) return;
    this.emit({ type: "transcript", speaker: "user", text, final: true });
    this.finalTranscriptCount += 1;
    void this.queueResponse(text).catch(() => undefined);
  }

  private queueResponse(text: string): Promise<LangMessages | undefined> {
    const previous = this.responseTask;
    if (previous) this.interrupt("new_turn");
    const task = (async () => {
      await previous?.catch(() => undefined);
      if (this.closing) return undefined;
      return this.respond(text);
    })().catch((error) => {
      if (isAbortError(error)) return undefined;
      this.emit({ type: "error", error: normalizeError(error) });
      throw error;
    });
    this.responseTask = task;
    return task;
  }

  private async respond(text: string): Promise<LangMessages> {
    const controller = new AbortController();
    this.responseController = controller;
    const segmenter = new StreamingTextSegmenter(this.segmenterOptions);
    const turnStartedAt = performance.now();
    let firstTokenReported = false;
    let firstAudioReported = false;
    let streamIndex = -1;
    let streamedText = "";
    let speechTail = Promise.resolve();

    const speak = (segment: string) => {
      speechTail = speechTail.then(async () => {
        if (controller.signal.aborted) return;
        this.emit({ type: "speech", speaker: "assistant", active: true });
        for await (const frame of this.textToSpeech.speak(segment, {
          signal: controller.signal,
        })) {
          if (!firstAudioReported) {
            firstAudioReported = true;
            this.emit({
              type: "latency",
              stage: "tts_first_audio",
              milliseconds: performance.now() - turnStartedAt,
            });
          }
          this.emit({ type: "audio", frame });
        }
      });
    };

    const unsubscribe = this.chatAgent.subscribe(event => {
      if (event.type !== "streaming" || event.data.msg.role !== "assistant") return;
      if (event.data.idx !== streamIndex) {
        streamIndex = event.data.idx;
        streamedText = "";
      }
      const textNow = event.data.msg.text;
      const delta = textNow.startsWith(streamedText)
        ? textNow.slice(streamedText.length)
        : textNow;
      streamedText = textNow;
      if (!delta) return;
      if (!firstTokenReported) {
        firstTokenReported = true;
        this.emit({
          type: "latency",
          stage: "llm_first_token",
          milliseconds: performance.now() - turnStartedAt,
        });
      }
      this.emit({ type: "transcript", speaker: "assistant", text: delta, final: false });
      for (const segment of segmenter.push(delta)) speak(segment);
    });

    try {
      const input = await this.buildUserMessage(text);
      const output = await this.chatAgent.run([input], { signal: controller.signal });
      if (!controller.signal.aborted) {
        for (const segment of segmenter.flush()) speak(segment);
        await speechTail;
        this.emit({ type: "speech", speaker: "assistant", active: false });
        this.emit({ type: "transcript", speaker: "assistant", text: output.answer, final: true });
        this.emit({
          type: "latency",
          stage: "turn_complete",
          milliseconds: performance.now() - turnStartedAt,
        });
        this.emit({ type: "turn_complete", output });
      }
      return output;
    } finally {
      unsubscribe();
      segmenter.clear();
      if (this.responseController === controller) this.responseController = undefined;
    }
  }

  private async buildUserMessage(text: string): Promise<LangMessage> {
    const items: LangMessageItem[] = [{ type: "text", text }];
    if (this.latestImage) items.push(await imageMessageItem(this.latestImage));
    return new LangMessage("user", items);
  }
}

async function imageMessageItem(image: LangContentImage): Promise<LangMessageItemImage> {
  switch (image.kind) {
    case "url":
      return { type: "image", url: image.url };
    case "base64":
      return { type: "image", base64: image.base64, mimeType: image.mimeType };
    case "bytes":
      return {
        type: "image",
        base64: bytesToBase64(image.bytes),
        mimeType: image.mimeType,
      };
    case "blob":
      return {
        type: "image",
        base64: bytesToBase64(await image.blob.arrayBuffer()),
        mimeType: image.mimeType || image.blob.type || undefined,
      };
  }
}

function bytesToBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const secondPresent = index + 1 < bytes.length;
    const thirdPresent = index + 2 < bytes.length;
    const second = secondPresent ? bytes[index + 1] : 0;
    const third = thirdPresent ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    result += alphabet[(value >> 18) & 63];
    result += alphabet[(value >> 12) & 63];
    result += secondPresent ? alphabet[(value >> 6) & 63] : "=";
    result += thirdPresent ? alphabet[value & 63] : "=";
  }
  return result;
}
