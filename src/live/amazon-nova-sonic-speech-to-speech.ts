import {
  assertPcmFrame,
  createAbortError,
  decodeBase64Pcm,
  encodePcmAsBase64,
  linkAbortSignal,
  throwIfAborted,
} from "../speech/audio.js";
import type { PcmAudioFormat, PcmAudioFrame } from "../speech/types.js";
import type {
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import { createObservableSpeechToSpeechSession } from "./session-events.js";
import {
  executeSpeechToSpeechToolCall,
  parseSpeechToSpeechToolCall,
  serializeSpeechToSpeechToolResult,
  speechToSpeechFunctionDeclarations,
} from "./live-lang-tools.js";

export type AmazonNovaSonicStreamInput = { chunk: { bytes: Uint8Array } };
export type AmazonNovaSonicInvocation = {
  body: AsyncIterable<unknown>;
  close?: () => void;
};

export type AmazonNovaSonicInvoker = (options: {
  modelId: string;
  region: string;
  body: AsyncIterable<AmazonNovaSonicStreamInput>;
  signal: AbortSignal;
}) => Promise<AmazonNovaSonicInvocation>;

export type AmazonNovaSonicSpeechToSpeechOptions = {
  model?: string;
  region?: string;
  voice?: string;
  maxTokens?: number;
  topP?: number;
  temperature?: number;
  endpointingSensitivity?: "LOW" | "MEDIUM" | "HIGH";
  invoke?: AmazonNovaSonicInvoker;
};

type AmazonNovaSonicConfig = Required<AmazonNovaSonicSpeechToSpeechOptions>;

const inputFormat: PcmAudioFormat = {
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate: 16000,
};

const outputFormat: PcmAudioFormat = {
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate: 24000,
};

export class AmazonNovaSonicSpeechToSpeech
  implements SpeechToSpeechProvider
{
  readonly inputFormat = inputFormat;
  readonly outputFormat = outputFormat;
  private readonly config: AmazonNovaSonicConfig;

  constructor(options: AmazonNovaSonicSpeechToSpeechOptions = {}) {
    this.config = {
      model: options.model ?? "amazon.nova-2-sonic-v1:0",
      region: options.region ?? "us-east-1",
      voice: options.voice ?? "tiffany",
      maxTokens: options.maxTokens ?? 1024,
      topP: options.topP ?? 0.9,
      temperature: options.temperature ?? 0.7,
      endpointingSensitivity: options.endpointingSensitivity ?? "MEDIUM",
      invoke: options.invoke ?? invokeNovaSonic,
    };
  }

  async createSession(
    options: SpeechToSpeechSessionOptions = {},
  ): Promise<SpeechToSpeechSession> {
    return createObservableSpeechToSpeechSession(options, async (events) => {
      const session = new AmazonNovaSonicSession(this.config, events);
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

class AmazonNovaSonicSession {
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private readonly input = new AsyncQueue<AmazonNovaSonicStreamInput>();
  private readonly promptName = crypto.randomUUID();
  private readonly audioContentName = crypto.randomUUID();
  private state: "connecting" | "open" | "closed" = "connecting";
  private closeTransport?: () => void;
  private responseActive = false;
  private responseInterrupted = false;
  private readonly contents = new Map<string, NovaContent>();
  private readonly seenToolCallIds = new Set<string>();

  constructor(
    private readonly config: AmazonNovaSonicConfig,
    private readonly session: SpeechToSpeechSessionOptions,
  ) {
    this.unlinkAbort = linkAbortSignal(session.signal, this.controller);
  }

  async connect(): Promise<void> {
    throwIfAborted(this.controller.signal);
    this.startInput();
    const invocation = await this.config.invoke({
      modelId: this.config.model,
      region: this.config.region,
      body: this.input,
      signal: this.controller.signal,
    });
    if (this.controller.signal.aborted) throw createAbortError();
    this.closeTransport = invocation.close;
    this.state = "open";
    void this.consumeOutput(invocation.body).catch((error) =>
      this.fail(toError(error)),
    );
  }

  async appendAudio(frame: PcmAudioFrame): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    assertPcmFrame(frame);
    if (frame.sampleRate !== inputFormat.sampleRate) {
      throw new Error(
        `Amazon Nova Sonic speech-to-speech requires ${inputFormat.sampleRate} Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }
    if (!frame.samples.length) return;
    this.pushEvent({
      audioInput: {
        promptName: this.promptName,
        contentName: this.audioContentName,
        content: encodePcmAsBase64(frame.samples),
      },
    });
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    const wasOpen = this.state === "open";
    this.state = "closed";
    if (wasOpen) {
      this.pushEvent({
        contentEnd: {
          promptName: this.promptName,
          contentName: this.audioContentName,
        },
      });
      this.pushEvent({ promptEnd: { promptName: this.promptName } });
      this.pushEvent({ sessionEnd: {} });
    }
    this.input.close();
    this.controller.abort();
    this.closeTransport?.();
    this.unlinkAbort();
  }

  private startInput(): void {
    const tools = speechToSpeechFunctionDeclarations(this.session);
    this.pushEvent({
      sessionStart: {
        inferenceConfiguration: {
          maxTokens: this.config.maxTokens,
          topP: this.config.topP,
          temperature: this.config.temperature,
        },
        turnDetectionConfiguration: {
          endpointingSensitivity: this.config.endpointingSensitivity,
        },
      },
    });
    this.pushEvent({
      promptStart: {
        promptName: this.promptName,
        textOutputConfiguration: { mediaType: "text/plain" },
        audioOutputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: outputFormat.sampleRate,
          sampleSizeBits: 16,
          channelCount: 1,
          voiceId: this.config.voice,
          encoding: "base64",
          audioType: "SPEECH",
        },
        ...(tools.length
          ? {
              toolUseOutputConfiguration: {
                mediaType: "application/json",
              },
              toolConfiguration: {
                tools: tools.map((tool) => ({
                  toolSpec: {
                    name: tool.name,
                    description: tool.description,
                    inputSchema: { json: tool.parameters },
                  },
                })),
                toolChoice: { auto: {} },
              },
            }
          : {}),
      },
    });
    if (this.session.instructions) {
      const contentName = crypto.randomUUID();
      this.pushEvent({
        contentStart: {
          promptName: this.promptName,
          contentName,
          type: "TEXT",
          interactive: false,
          role: "SYSTEM",
          textInputConfiguration: { mediaType: "text/plain" },
        },
      });
      this.pushEvent({
        textInput: {
          promptName: this.promptName,
          contentName,
          content: this.session.instructions,
        },
      });
      this.pushEvent({
        contentEnd: { promptName: this.promptName, contentName },
      });
    }
    this.pushEvent({
      contentStart: {
        promptName: this.promptName,
        contentName: this.audioContentName,
        type: "AUDIO",
        interactive: true,
        role: "USER",
        audioInputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: inputFormat.sampleRate,
          sampleSizeBits: 16,
          channelCount: 1,
          encoding: "base64",
          audioType: "SPEECH",
        },
      },
    });
  }

  private async consumeOutput(body: AsyncIterable<unknown>): Promise<void> {
    for await (const output of body) {
      if (this.state === "closed") return;
      const streamOutput = objectValue(output);
      if (!streamOutput) continue;
      const chunk = objectValue(streamOutput.chunk);
      if (chunk?.bytes instanceof Uint8Array) {
        const payload = JSON.parse(
          new TextDecoder().decode(chunk.bytes),
        ) as { event?: Record<string, unknown> };
        if (payload.event) this.handleEvent(payload.event);
        continue;
      }
      const error = streamError(streamOutput);
      if (error) throw error;
    }
    if (this.state === "open") {
      throw new Error("Amazon Nova Sonic response stream closed");
    }
  }

  private handleEvent(event: Record<string, unknown>): void {
    if (event.completionStart) {
      this.seenToolCallIds.clear();
      this.responseActive = true;
      this.responseInterrupted = false;
      this.session.onEvent?.({ type: "response-start" });
      return;
    }
    const contentStart = objectValue(event.contentStart);
    if (contentStart) {
      const id = stringValue(contentStart.contentId);
      if (!id) return;
      this.contents.set(id, {
        role: stringValue(contentStart.role),
        generationStage: generationStage(contentStart.additionalModelFields),
        text: "",
      });
      return;
    }
    const textOutput = objectValue(event.textOutput);
    if (textOutput) {
      const id = stringValue(textOutput.contentId);
      const content = id ? this.contents.get(id) : undefined;
      const text = stringValue(textOutput.content);
      if (content && text) content.text += text;
      return;
    }
    const audioOutput = objectValue(event.audioOutput);
    if (audioOutput) {
      const audio = stringValue(audioOutput.content);
      if (audio) {
        this.session.onEvent?.({
          type: "output-audio",
          frame: {
            ...outputFormat,
            samples: decodeBase64Pcm(audio, "Amazon Nova Sonic"),
          },
        });
      }
      return;
    }
    const toolUse = objectValue(event.toolUse);
    if (toolUse) {
      const call = parseSpeechToSpeechToolCall(
        toolUse.toolUseId,
        toolUse.toolName,
        toolUse.content,
      );
      const promptName = stringValue(toolUse.promptName) || this.promptName;
      const contentName = stringValue(toolUse.contentId);
      if (!call || !contentName) {
        this.session.onEvent?.({
          type: "error",
          error: new Error("Amazon Nova Sonic returned an invalid tool call"),
        });
        return;
      }
      if (this.seenToolCallIds.has(call.callId)) return;
      this.seenToolCallIds.add(call.callId);
      void this.handleToolCall(call, promptName, contentName).catch((error) =>
        this.fail(toError(error))
      );
      return;
    }
    const contentEnd = objectValue(event.contentEnd);
    if (contentEnd) {
      const id = stringValue(contentEnd.contentId);
      const content = id ? this.contents.get(id) : undefined;
      if (id) this.contents.delete(id);
      if (stringValue(contentEnd.stopReason) === "INTERRUPTED") {
        this.emitInterrupted();
      }
      if (!id || !content?.text || content.generationStage === "SPECULATIVE") {
        return;
      }
      if (content.role === "USER") {
        this.emitTranscript("input-transcript", content.text, id);
      } else if (content.role === "ASSISTANT") {
        this.emitTranscript("output-transcript", content.text, id);
      }
      return;
    }
    if (event.completionEnd) {
      if (this.responseActive && !this.responseInterrupted) {
        this.session.onEvent?.({ type: "response-end" });
      }
      this.responseActive = false;
    }
  }

  private emitTranscript(
    type: "input-transcript" | "output-transcript",
    text: string,
    id: string,
  ): void {
    this.session.onEvent?.({
      type,
      transcript: { type: "final", text, id },
    });
  }

  private emitInterrupted(): void {
    if (!this.responseActive || this.responseInterrupted) return;
    this.responseInterrupted = true;
    this.session.onEvent?.({ type: "response-interrupted" });
  }

  private async handleToolCall(
    call: NonNullable<ReturnType<typeof parseSpeechToSpeechToolCall>>,
    promptName: string,
    contentName: string,
  ): Promise<void> {
    const result = await executeSpeechToSpeechToolCall(
      this.session,
      call,
      this.controller.signal,
    );
    this.pushEvent({
      toolResult: {
        promptName,
        contentName,
        content: serializeSpeechToSpeechToolResult(result.result),
      },
    });
  }

  private pushEvent(event: Record<string, unknown>): void {
    this.input.push({
      chunk: {
        bytes: new TextEncoder().encode(JSON.stringify({ event })),
      },
    });
  }

  private fail(error: Error): void {
    if (this.state === "closed") return;
    const shouldNotify = this.state === "open" && error.name !== "AbortError";
    this.state = "closed";
    this.input.fail(error);
    this.controller.abort();
    this.closeTransport?.();
    this.unlinkAbort();
    if (shouldNotify) {
      try {
        this.session.onEvent?.({ type: "error", error });
      } catch {
        // A consumer callback must not prevent stream cleanup.
      }
    }
  }

  private assertOpen(): void {
    if (this.state !== "open") {
      throw new Error(`Speech-to-speech session is ${this.state}`);
    }
  }
}

type NovaContent = {
  role: string;
  generationStage: string;
  text: string;
};

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private ended = false;
  private error?: Error;

  push(value: T): void {
    if (this.ended) return;
    const reader = this.readers.shift();
    if (reader) reader.resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    for (const reader of this.readers.splice(0)) {
      reader.resolve({ value: undefined, done: true });
    }
  }

  fail(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.error = error;
    for (const reader of this.readers.splice(0)) reader.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.error) return Promise.reject(this.error);
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.readers.push({ resolve, reject });
        });
      },
    };
  }
}

async function invokeNovaSonic(options: {
  modelId: string;
  region: string;
  body: AsyncIterable<AmazonNovaSonicStreamInput>;
  signal: AbortSignal;
}): Promise<AmazonNovaSonicInvocation> {
  let sdk: typeof import("@aws-sdk/client-bedrock-runtime");
  try {
    sdk = await import("@aws-sdk/client-bedrock-runtime");
  } catch {
    throw new Error(
      "Amazon Nova Sonic requires @aws-sdk/client-bedrock-runtime",
    );
  }
  const client = new sdk.BedrockRuntimeClient({ region: options.region });
  const response = await client.send(
    new sdk.InvokeModelWithBidirectionalStreamCommand({
      modelId: options.modelId,
      body: options.body,
    }),
    { abortSignal: options.signal },
  );
  if (!response.body) {
    client.destroy();
    throw new Error("Amazon Nova Sonic returned no response stream");
  }
  return {
    body: response.body,
    close: () => client.destroy(),
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function generationStage(value: unknown): string {
  if (typeof value !== "string") return "FINAL";
  try {
    const fields = JSON.parse(value) as { generationStage?: unknown };
    return stringValue(fields.generationStage) || "FINAL";
  } catch {
    return "FINAL";
  }
}

function streamError(output: Record<string, unknown>): Error | undefined {
  for (const [name, value] of Object.entries(output)) {
    if (name === "chunk") continue;
    const details = objectValue(value);
    if (!details) continue;
    const message = stringValue(details.message);
    return new Error(message || `Amazon Nova Sonic stream failed (${name})`);
  }
  return undefined;
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("Amazon Nova Sonic speech-to-speech failed");
}
