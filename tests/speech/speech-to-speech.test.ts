import { describe, expect, it } from "vitest";
import {
  GeminiLiveSpeechToSpeech,
  MockSpeechToSpeech,
  OpenAIRealtimeSpeechToSpeech,
  SpeechToSpeech,
  type PcmAudioFrame,
  type RealtimeSpeechWebSocketData,
  type SpeechToSpeechEvent,
} from "../../src/unstable/speech/index.ts";

type SocketListener = (event: { data?: unknown; error?: unknown }) => void;

class FakeLiveSocket {
  readonly sent: Record<string, any>[] = [];
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Set<SocketListener>>();

  constructor(private readonly setupReply: Record<string, unknown>) {
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
    if (message.type === "session.update" || message.setup) {
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

  private emit(type: string, event: { data?: unknown; error?: unknown }): void {
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
        if (event.type === "response-interrupted") interrupted.resolve(undefined);
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
    const delayed = await new MockSpeechToSpeech({ delayMs: 1000 }).createSession(
      { signal: controller.signal },
    );
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
    let connection: { url: string; headers: Record<string, string> } | undefined;
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
      (event): event is Extract<SpeechToSpeechEvent, { type: "output-audio" }> =>
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

describe("Gemini Live speech-to-speech", () => {
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
