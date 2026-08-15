import { describe, expect, it } from "vitest";
import {
  AmazonNovaSonicSpeechToSpeech,
  AzureVoiceLiveSpeechToSpeech,
  GeminiLiveSpeechToSpeech,
  MockSpeechToSpeech,
  OpenAIRealtimeSpeechToSpeech,
  SpeechToSpeech,
  XAIVoiceSpeechToSpeech,
  type PcmAudioFrame,
  type RealtimeSpeechWebSocketData,
  type SpeechToSpeechEvent,
} from "../../src/unstable/speech/index.ts";

type SocketEvent = {
  data?: unknown;
  error?: unknown;
  code?: unknown;
  reason?: unknown;
};

type SocketListener = (event: SocketEvent) => void;

class FakeLiveSocket {
  readonly sent: Record<string, any>[] = [];
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Set<SocketListener>>();

  constructor(private readonly setupReply?: Record<string, unknown>) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
    });
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(value: RealtimeSpeechWebSocketData): void {
    if (typeof value !== "string") throw new Error("Expected JSON");
    const message = JSON.parse(value);
    this.sent.push(message);
    if (
      this.setupReply &&
      (message.type === "session.update" || message.setup)
    ) {
      queueMicrotask(() => this.serverMessage(this.setupReply));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", {}));
  }

  serverMessage(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  serverClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const frame = (samples: number[], sampleRate: number): PcmAudioFrame => ({
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate,
  samples: new Int16Array(samples),
});

describe("speech-to-speech mock", () => {
  it("supports typed event listeners without letting observers break the stream", async () => {
    const provider = SpeechToSpeech.mock({ outputTranscript: "hello" });
    const session = await provider.createSession();
    const allEvents: string[] = [];
    const responseEvents: string[] = [];
    const onAnyEvent = (event: SpeechToSpeechEvent) => {
      allEvents.push(event.type);
    };
    const onResponseStart = () => {
      responseEvents.push("started");
    };
    session.addEventListener("event", onAnyEvent);
    session.addEventListener("response-start", onResponseStart);
    session.addEventListener("response-start", () => {
      throw new Error("Observer failure");
    });

    const completed = deferred<void>();
    session.addEventListener("response-end", () => completed.resolve());
    await session.appendAudio(frame([1], 24000));
    await completed.promise;

    expect(responseEvents).toEqual(["started"]);
    expect(allEvents).toEqual([
      "response-start",
      "output-audio",
      "output-transcript",
      "response-end",
    ]);
    session.removeEventListener("event", onAnyEvent);
    session.removeEventListener("response-start", onResponseStart);
    await session.close();
  });

  it("records input and emits deterministic streaming events", async () => {
    const events: SpeechToSpeechEvent[] = [];
    const completed = deferred<void>();
    const provider = SpeechToSpeech.mock({
      outputFrames: [new Int16Array([1, -2]), new Int16Array([3])],
      inputTranscript: "hello",
      outputTranscript: "hi",
    });
    const session = await provider.createSession({
      onEvent(event) {
        events.push(event);
        if (event.type === "response-end") completed.resolve(undefined);
      },
    });

    await session.appendAudio(frame([4, 5], 24000));
    await completed.promise;

    expect(provider.receivedFrames[0].samples).toEqual(new Int16Array([4, 5]));
    expect(events.map((event) => event.type)).toEqual([
      "response-start",
      "input-transcript",
      "output-audio",
      "output-audio",
      "output-transcript",
      "response-end",
    ]);
    await session.close();
  });

  it("validates PCM, emits interruption, and stops delayed output on abort", async () => {
    const events: SpeechToSpeechEvent[] = [];
    const interrupted = deferred<void>();
    const provider = new MockSpeechToSpeech({
      inputSampleRate: 16000,
      outputFrames: [new Int16Array([1]), new Int16Array([2])],
      interruptAfterFrame: 1,
    });
    const session = await provider.createSession({
      onEvent(event) {
        events.push(event);
        if (event.type === "response-interrupted")
          interrupted.resolve(undefined);
      },
    });

    await expect(session.appendAudio(frame([1], 24000))).rejects.toThrow(
      "without resampling",
    );
    await session.appendAudio(frame([1], 16000));
    await interrupted.promise;
    expect(events.map((event) => event.type)).toEqual([
      "response-start",
      "output-audio",
      "response-interrupted",
    ]);

    const controller = new AbortController();
    const delayed = await new MockSpeechToSpeech({
      delayMs: 1000,
    }).createSession({ signal: controller.signal });
    await delayed.appendAudio(frame([1], 24000));
    controller.abort();
    await expect(delayed.appendAudio(frame([1], 24000))).rejects.toMatchObject({
      name: "AbortError",
    });
    await delayed.close();
    await session.close();
  });
});

describe("OpenAI realtime speech-to-speech", () => {
  it("configures one live session and normalizes audio, transcripts, and interruption", async () => {
    const socket = new FakeLiveSocket({ type: "session.updated" });
    const events: SpeechToSpeechEvent[] = [];
    let connection:
      { url: string; headers: Record<string, string> } | undefined;
    const provider = new OpenAIRealtimeSpeechToSpeech({
      apiKey: "test key",
      model: "voice-model",
      voice: "cedar",
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        return socket;
      },
    });
    const session = await provider.createSession({
      instructions: "Be brief.",
      onEvent: (event) => events.push(event),
    });

    expect(connection).toEqual({
      url: "wss://api.openai.com/v1/realtime?model=voice-model",
      headers: { Authorization: "Bearer test key" },
    });
    expect(socket.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: "Be brief.",
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            turn_detection: {
              type: "server_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: "cedar",
          },
        },
      },
    });

    await session.appendAudio(frame([1, -2], 24000));
    expect(socket.sent[1]).toMatchObject({
      type: "input_audio_buffer.append",
      audio: "AQD+/w==",
    });
    socket.serverMessage({ type: "response.created" });
    socket.serverMessage({
      type: "conversation.item.input_audio_transcription.delta",
      delta: "hel",
    });
    socket.serverMessage({
      type: "response.output_audio_transcript.delta",
      delta: "hi",
    });
    socket.serverMessage({
      type: "response.output_audio.delta",
      delta: "AQD+/w==",
    });
    socket.serverMessage({ type: "input_audio_buffer.speech_started" });
    socket.serverMessage({
      type: "response.done",
      response: { status: "cancelled" },
    });
    await settleMessages();

    expect(events.map((event) => event.type)).toEqual([
      "response-start",
      "input-transcript",
      "output-transcript",
      "output-audio",
      "response-interrupted",
    ]);
    const audioEvent = events.find(
      (
        event,
      ): event is Extract<SpeechToSpeechEvent, { type: "output-audio" }> =>
        event.type === "output-audio",
    );
    expect(audioEvent?.frame.samples).toEqual(new Int16Array([1, -2]));
    await session.close();
    expect(socket.closed).toBe(true);
    await expect(session.appendAudio(frame([1], 24000))).rejects.toThrow(
      "session is closed",
    );
  });

  it("surfaces asynchronous provider errors after setup", async () => {
    const socket = new FakeLiveSocket({ type: "session.updated" });
    const events: SpeechToSpeechEvent[] = [];
    const session = await new OpenAIRealtimeSpeechToSpeech({
      apiKey: "test",
      createWebSocket: () => socket,
    }).createSession({ onEvent: (event) => events.push(event) });

    socket.serverMessage({
      type: "error",
      error: { message: "Realtime failed" },
    });
    await settleMessages();

    expect(events).toMatchObject([
      { type: "error", error: { message: "Realtime failed" } },
    ]);
    expect(socket.closed).toBe(true);
    await session.close();
  });
});

describe("Azure Voice Live speech-to-speech", () => {
  it("configures Azure and normalizes its realtime audio event names", async () => {
    const socket = new FakeLiveSocket({ type: "session.updated" });
    const events: SpeechToSpeechEvent[] = [];
    let connection:
      { url: string; headers: Record<string, string> } | undefined;
    const provider = new AzureVoiceLiveSpeechToSpeech({
      endpoint: "https://voice-resource.services.ai.azure.com",
      apiKey: "azure key",
      model: "gpt-realtime-mini",
      voice: "alloy",
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        return socket;
      },
    });
    const session = await provider.createSession({
      instructions: "Be brief.",
      onEvent: (event) => events.push(event),
    });

    expect(connection).toEqual({
      url: "wss://voice-resource.services.ai.azure.com/voice-live/realtime?api-version=2026-04-10&model=gpt-realtime-mini",
      headers: { "api-key": "azure key" },
    });
    expect(socket.sent[0]).toEqual({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: { type: "openai", name: "alloy" },
        instructions: "Be brief.",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_sampling_rate: 24000,
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "azure_semantic_vad",
          threshold: 0.5,
          prefix_padding_ms: 420,
          silence_duration_ms: 500,
        },
      },
    });

    socket.serverMessage({ type: "response.created" });
    socket.serverMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "azure-user",
      transcript: "hello",
    });
    socket.serverMessage({
      type: "response.audio_transcript.delta",
      item_id: "azure-assistant",
      delta: "hi",
    });
    socket.serverMessage({
      type: "response.audio.delta",
      item_id: "azure-assistant",
      delta: "AQD+/w==",
    });
    socket.serverMessage({
      type: "response.audio_transcript.done",
      item_id: "azure-assistant",
      transcript: "hi there",
    });
    socket.serverMessage({ type: "response.done", response: {} });
    await settleMessages();

    expect(events).toMatchObject([
      { type: "response-start" },
      {
        type: "input-transcript",
        transcript: { type: "final", text: "hello", id: "azure-user" },
      },
      {
        type: "output-transcript",
        transcript: { type: "delta", text: "hi" },
      },
      { type: "output-audio", frame: { sampleRate: 24000 } },
      {
        type: "output-transcript",
        transcript: {
          type: "final",
          text: "hi there",
          id: "azure-assistant",
        },
      },
      { type: "response-end" },
    ]);

    await session.close();
  });
});

describe("Amazon Nova Sonic speech-to-speech", () => {
  it("uses the Bedrock stream while preserving normalized session events", async () => {
    const outputs = new PushAsyncIterable<unknown>();
    const inputs: Record<string, any>[] = [];
    const events: SpeechToSpeechEvent[] = [];
    let invocation:
      { modelId: string; region: string } | undefined;
    const provider = new AmazonNovaSonicSpeechToSpeech({
      model: "amazon.nova-2-sonic-v1:0",
      region: "us-west-2",
      voice: "matthew",
      invoke: async ({ modelId, region, body }) => {
        invocation = { modelId, region };
        void (async () => {
          for await (const message of body) {
            inputs.push(
              JSON.parse(new TextDecoder().decode(message.chunk.bytes)),
            );
          }
        })();
        return { body: outputs };
      },
    });
    const session = await provider.createSession({
      instructions: "Be brief.",
      onEvent: (event) => events.push(event),
    });
    await settleMessages();

    expect(invocation).toEqual({
      modelId: "amazon.nova-2-sonic-v1:0",
      region: "us-west-2",
    });
    expect(provider.inputFormat.sampleRate).toBe(16000);
    expect(provider.outputFormat.sampleRate).toBe(24000);
    expect(inputs[0]).toMatchObject({
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: 1024,
            topP: 0.9,
            temperature: 0.7,
          },
          turnDetectionConfiguration: { endpointingSensitivity: "MEDIUM" },
        },
      },
    });
    expect(inputs[1]).toMatchObject({
      event: {
        promptStart: {
          audioOutputConfiguration: {
            sampleRateHertz: 24000,
            voiceId: "matthew",
          },
        },
      },
    });
    expect(inputs[2]).toMatchObject({
      event: {
        contentStart: { role: "SYSTEM", interactive: false },
      },
    });

    await session.appendAudio(frame([1, -2], 16000));
    await settleMessages();
    expect(inputs.at(-1)).toMatchObject({
      event: { audioInput: { content: "AQD+/w==" } },
    });

    outputs.push(novaEvent({ completionStart: { completionId: "turn-1" } }));
    outputs.push(
      novaEvent({
        contentStart: {
          contentId: "user-text",
          type: "TEXT",
          role: "USER",
          additionalModelFields: '{"generationStage":"FINAL"}',
        },
      }),
    );
    outputs.push(
      novaEvent({
        textOutput: { contentId: "user-text", content: "hello" },
      }),
    );
    outputs.push(
      novaEvent({
        contentEnd: {
          contentId: "user-text",
          type: "TEXT",
          stopReason: "END_TURN",
        },
      }),
    );
    outputs.push(
      novaEvent({
        contentStart: {
          contentId: "preview",
          type: "TEXT",
          role: "ASSISTANT",
          additionalModelFields: '{"generationStage":"SPECULATIVE"}',
        },
      }),
    );
    outputs.push(
      novaEvent({
        textOutput: { contentId: "preview", content: "ignored preview" },
      }),
    );
    outputs.push(
      novaEvent({
        contentEnd: { contentId: "preview", type: "TEXT" },
      }),
    );
    outputs.push(
      novaEvent({
        audioOutput: { contentId: "audio", content: "AQD+/w==" },
      }),
    );
    outputs.push(
      novaEvent({
        contentStart: {
          contentId: "assistant-text",
          type: "TEXT",
          role: "ASSISTANT",
          additionalModelFields: '{"generationStage":"FINAL"}',
        },
      }),
    );
    outputs.push(
      novaEvent({
        textOutput: { contentId: "assistant-text", content: "hi there" },
      }),
    );
    outputs.push(
      novaEvent({
        contentEnd: {
          contentId: "assistant-text",
          type: "TEXT",
          stopReason: "END_TURN",
        },
      }),
    );
    outputs.push(novaEvent({ completionEnd: { stopReason: "END_TURN" } }));
    await settleMessages();

    expect(events).toMatchObject([
      { type: "response-start" },
      {
        type: "input-transcript",
        transcript: { type: "final", text: "hello", id: "user-text" },
      },
      { type: "output-audio", frame: { sampleRate: 24000 } },
      {
        type: "output-transcript",
        transcript: {
          type: "final",
          text: "hi there",
          id: "assistant-text",
        },
      },
      { type: "response-end" },
    ]);

    outputs.push(novaEvent({ completionStart: { completionId: "turn-2" } }));
    outputs.push(
      novaEvent({
        contentEnd: {
          contentId: "interrupted-audio",
          type: "AUDIO",
          stopReason: "INTERRUPTED",
        },
      }),
    );
    outputs.push(novaEvent({ completionEnd: { stopReason: "INTERRUPTED" } }));
    await settleMessages();
    expect(events.slice(-2)).toMatchObject([
      { type: "response-start" },
      { type: "response-interrupted" },
    ]);

    await session.close();
    await settleMessages();
    expect(inputs.slice(-3).map((input) => Object.keys(input.event)[0])).toEqual([
      "contentEnd",
      "promptEnd",
      "sessionEnd",
    ]);
  });
});

describe("xAI Voice speech-to-speech", () => {
  it("configures xAI and normalizes its OpenAI-compatible events", async () => {
    const socket = new FakeLiveSocket({ type: "session.updated" });
    const events: SpeechToSpeechEvent[] = [];
    let connection:
      { url: string; headers: Record<string, string> } | undefined;
    const provider = new XAIVoiceSpeechToSpeech({
      apiKey: "xai key",
      model: "grok-voice-think-fast-2.0",
      voice: "eve",
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        return socket;
      },
    });
    const session = await provider.createSession({
      instructions: "Be brief.",
      onEvent: (event) => events.push(event),
    });

    expect(connection).toEqual({
      url: "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0",
      headers: { Authorization: "Bearer xai key" },
    });
    expect(socket.sent[0]).toEqual({
      type: "session.update",
      session: {
        voice: "eve",
        instructions: "Be brief.",
        turn_detection: { type: "server_vad" },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "grok-transcribe" },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
          },
        },
      },
    });

    await session.appendAudio(frame([1, -2], 24000));
    expect(socket.sent[1]).toEqual({
      type: "input_audio_buffer.append",
      audio: "AQD+/w==",
    });
    socket.serverMessage({
      type: "conversation.item.input_audio_transcription.updated",
      transcript: "hel",
    });
    socket.serverMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hel",
      item_id: "user-item",
    });
    socket.serverMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello",
      item_id: "user-item",
    });
    socket.serverMessage({ type: "response.created" });
    socket.serverMessage({
      type: "response.output_audio_transcript.delta",
      delta: "hi",
    });
    socket.serverMessage({
      type: "response.output_audio.delta",
      delta: "AQD+/w==",
    });
    socket.serverMessage({ type: "response.done", response: {} });
    await settleMessages();

    expect(events.map((event) => event.type)).toEqual([
      "input-transcript",
      "input-transcript",
      "response-start",
      "output-transcript",
      "output-audio",
      "response-end",
    ]);
    expect(events[0]).toEqual({
      type: "input-transcript",
      transcript: { type: "final", text: "hel", id: "user-item" },
    });
    expect(events[1]).toEqual({
      type: "input-transcript",
      transcript: { type: "final", text: "hello", id: "user-item" },
    });
    const audioEvent = events.find(
      (
        event,
      ): event is Extract<SpeechToSpeechEvent, { type: "output-audio" }> =>
        event.type === "output-audio",
    );
    expect(audioEvent?.frame.samples).toEqual(new Int16Array([1, -2]));
    await session.close();
    expect(socket.closed).toBe(true);
  });

  it("keeps the session open after a recoverable provider error", async () => {
    const socket = new FakeLiveSocket({ type: "session.updated" });
    const events: SpeechToSpeechEvent[] = [];
    const session = await SpeechToSpeech.xaiVoice({
      apiKey: "test",
      createWebSocket: () => socket,
    }).createSession({ onEvent: (event) => events.push(event) });

    socket.serverMessage({
      error: { message: "Turn rejected" },
      type: "error",
    });
    await settleMessages();

    expect(events).toMatchObject([
      { type: "error", error: { message: "Turn rejected" } },
    ]);
    expect(socket.closed).toBe(false);
    await session.appendAudio(frame([1], 24000));
    await session.close();
  });
});

describe("Gemini Live speech-to-speech", () => {
  it("preserves the provider close reason when setup is rejected", async () => {
    const socket = new FakeLiveSocket();
    const connection = new GeminiLiveSpeechToSpeech({
      apiKey: "invalid key",
      createWebSocket: () => socket,
    }).createSession();
    await settleMessages();

    socket.serverClose(1007, "API key not valid");

    await expect(connection).rejects.toThrow(
      "Gemini Live speech-to-speech connection closed (1007: API key not valid)",
    );
  });

  it("uses Gemini formats while preserving the same application events", async () => {
    const socket = new FakeLiveSocket({ setupComplete: {} });
    const events: SpeechToSpeechEvent[] = [];
    let connectionURL = "";
    const provider = new GeminiLiveSpeechToSpeech({
      apiKey: "google key",
      model: "live-model",
      voice: "Kore",
      createWebSocket: (url) => {
        connectionURL = url;
        return socket;
      },
    });
    const session = await provider.createSession({
      instructions: "Be brief.",
      onEvent: (event) => events.push(event),
    });

    expect(connectionURL).toBe(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=google%20key",
    );
    expect(socket.sent[0]).toEqual({
      setup: {
        model: "models/live-model",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
        systemInstruction: { parts: [{ text: "Be brief." }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });

    await session.appendAudio(frame([1, -2], 16000));
    expect(socket.sent[1]).toEqual({
      realtimeInput: {
        audio: {
          data: "AQD+/w==",
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
    socket.serverMessage({
      serverContent: {
        inputTranscription: { text: "hello" },
        outputTranscription: { text: "hi" },
        modelTurn: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/pcm;rate=24000",
                data: "AQD+/w==",
              },
            },
          ],
        },
        turnComplete: true,
      },
    });
    await settleMessages();

    expect(events.map((event) => event.type)).toEqual([
      "input-transcript",
      "response-start",
      "output-transcript",
      "output-audio",
      "response-end",
    ]);
    await expect(session.appendAudio(frame([1], 24000))).rejects.toThrow(
      "without resampling",
    );
    await session.close();
    expect(socket.sent.at(-1)).toEqual({
      realtimeInput: { audioStreamEnd: true },
    });
    await expect(session.appendAudio(frame([1], 16000))).rejects.toThrow(
      "session is closed",
    );
  });

  it("surfaces asynchronous provider errors after setup", async () => {
    const socket = new FakeLiveSocket({ setupComplete: {} });
    const events: SpeechToSpeechEvent[] = [];
    const session = await new GeminiLiveSpeechToSpeech({
      apiKey: "test",
      createWebSocket: () => socket,
    }).createSession({ onEvent: (event) => events.push(event) });

    socket.serverMessage({ error: { message: "Live failed" } });
    await settleMessages();

    expect(events).toMatchObject([
      { type: "error", error: { message: "Live failed" } },
    ]);
    expect(socket.closed).toBe(true);
    await session.close();
  });
});

async function settleMessages(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function novaEvent(event: Record<string, unknown>): {
  chunk: { bytes: Uint8Array };
} {
  return {
    chunk: {
      bytes: new TextEncoder().encode(JSON.stringify({ event })),
    },
  };
}

class PushAsyncIterable<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(value: IteratorResult<T>) => void> = [];

  push(value: T): void {
    const reader = this.readers.shift();
    if (reader) reader({ value, done: false });
    else this.values.push(value);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        return new Promise<IteratorResult<T>>((resolve) => {
          this.readers.push(resolve);
        });
      },
    };
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
