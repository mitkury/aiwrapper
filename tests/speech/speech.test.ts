import { afterEach, describe, expect, it } from "vitest";
import { setHttpRequestImpl } from "../../src/http-request.ts";
import {
  ElevenLabsTextToSpeech,
  MockSpeechToText,
  MockTextToSpeech,
  OpenAIRealtimeSpeechToText,
  OpenAISpeechToText,
  OpenAITextToSpeech,
  type PcmAudioFrame,
} from "../../src/unstable/speech/index.ts";

type SocketListener = (event: { data?: unknown; error?: unknown }) => void;

class FakeOpenAIRealtimeSocket {
  readonly sent: Record<string, any>[] = [];
  readyState = 0;
  closed = false;
  private turn = 0;
  private readonly listeners = new Map<string, Set<SocketListener>>();

  constructor() {
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

  send(value: string): void {
    const event = JSON.parse(value);
    this.sent.push(event);
    if (event.type === "session.update") {
      queueMicrotask(() => this.message({ type: "session.updated" }));
    }
    if (event.type === "input_audio_buffer.append") {
      queueMicrotask(() => this.message({
        type: "conversation.item.input_audio_transcription.delta",
        delta: this.turn === 0 ? "hel" : "aga",
      }));
    }
    if (event.type === "input_audio_buffer.commit") {
      const transcript = this.turn === 0 ? "hello" : "again";
      this.turn++;
      queueMicrotask(() => this.message({
        type: "conversation.item.input_audio_transcription.completed",
        transcript,
      }));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", {}));
  }

  private message(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  private emit(type: string, event: { data?: unknown; error?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const nativeFetch = globalThis.fetch;

afterEach(() => {
  setHttpRequestImpl((url, options) => nativeFetch(url, options));
});

const frame = (
  samples: number[],
  sampleRate = 16000,
): PcmAudioFrame => ({
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate,
  samples: new Int16Array(samples),
});

describe("speech mocks", () => {
  it("keeps the STT session shape used by batch and streaming providers", async () => {
    const events: unknown[] = [];
    const provider = new MockSpeechToText({
      transcript: frames => `${frames[0].samples.length} samples`,
      languages: ["en"],
    });
    const session = await provider.createSession({
      onTranscript: event => events.push(event),
    });

    await session.appendAudio(frame([1, 2, 3]));
    const result = await session.finish();

    expect(result).toEqual({ text: "3 samples", languages: ["en"] });
    expect(events).toEqual([{
      type: "final",
      text: "3 samples",
      languages: ["en"],
    }]);
  });

  it("makes mock STT enforce the real providers' per-turn sample-rate rule", async () => {
    const session = await new MockSpeechToText().createSession();
    await session.appendAudio(frame([1], 16000));

    await expect(session.appendAudio(frame([2], 24000))).rejects.toThrow(
      "without resampling",
    );

    await session.commit();
    await expect(session.appendAudio(frame([3], 24000))).resolves.toBeUndefined();
    await session.close();
  });

  it("emits declared PCM frames and records one speak call per segment", async () => {
    const provider = new MockTextToSpeech({
      sampleRate: 24000,
      frames: [new Int16Array([1, -2]), new Int16Array([3])],
    });

    const frames = [];
    for await (const audio of provider.speak("First clause.")) {
      frames.push(audio);
    }

    expect(provider.spokenTexts).toEqual(["First clause."]);
    expect(frames.map(audio => ({
      encoding: audio.encoding,
      channels: audio.channels,
      sampleRate: audio.sampleRate,
      samples: [...audio.samples],
    }))).toEqual([
      { encoding: "pcm_s16le", channels: 1, sampleRate: 24000, samples: [1, -2] },
      { encoding: "pcm_s16le", channels: 1, sampleRate: 24000, samples: [3] },
    ]);
  });

  it("stops mock TTS promptly when aborted", async () => {
    const provider = new MockTextToSpeech({ delayMs: 1000 });
    const controller = new AbortController();
    const iterator = provider.speak("Cancelled clause", {
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const pending = iterator.next();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("makes mock TTS reject empty segments like real providers", async () => {
    const provider = new MockTextToSpeech();
    const iterator = provider.speak("")[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow(
      "Text-to-speech input cannot be empty",
    );
    expect(provider.spokenTexts).toEqual([]);
  });
});

describe("OpenAI speech to text", () => {
  it("wraps PCM in a WAV container without resampling", async () => {
    let form: FormData | undefined;
    setHttpRequestImpl(async (_url, options) => {
      form = options.body as FormData;
      return new Response(JSON.stringify({
        text: "hello",
        languages: [{ code: "en" }],
      }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const provider = new OpenAISpeechToText({ apiKey: "test" });
    const session = await provider.createSession();
    await session.appendAudio(frame([0x1234, -2], 16000));

    const result = await session.finish();
    const file = form?.get("file");
    expect(file).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getInt16(44, true)).toBe(0x1234);
    expect(view.getInt16(46, true)).toBe(-2);
    expect(form?.get("model")).toBe("gpt-transcribe");
    expect(result).toEqual({ text: "hello", languages: ["en"] });
  });

  it("rejects sample-rate changes instead of silently resampling", async () => {
    const provider = new OpenAISpeechToText({ apiKey: "test" });
    const session = await provider.createSession();
    await session.appendAudio(frame([1], 16000));

    await expect(session.appendAudio(frame([2], 24000))).rejects.toThrow(
      "cannot accept 24000 Hz without resampling",
    );
  });
});

describe("OpenAI realtime speech to text", () => {
  it("streams 24 kHz PCM and reuses one connection across committed turns", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const events: unknown[] = [];
    let connection: { url: string; headers: Record<string, string> } | undefined;
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      prompt: "AIWrapper voice test",
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        return socket;
      },
    });
    const session = await provider.createSession({
      onTranscript: event => events.push(event),
    });

    await session.appendAudio(frame([0x1234, -2], 24000));
    const first = await session.commit();
    await session.appendAudio(frame([7], 24000));
    const second = await session.commit();
    await session.close();

    expect(provider.inputFormat).toEqual({
      encoding: "pcm_s16le",
      channels: 1,
      sampleRate: 24000,
    });
    expect(connection).toEqual({
      url: "wss://api.openai.com/v1/realtime?intent=transcription",
      headers: { Authorization: "Bearer test" },
    });
    expect(socket.sent[0]).toEqual({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: "gpt-live-transcribe",
              prompt: "AIWrapper voice test",
            },
            turn_detection: null,
          },
        },
      },
    });
    expect(socket.sent.filter(event => event.type === "input_audio_buffer.append"))
      .toEqual([
        { type: "input_audio_buffer.append", audio: "NBL+/w==" },
        { type: "input_audio_buffer.append", audio: "BwA=" },
      ]);
    expect(first).toEqual({ text: "hello" });
    expect(second).toEqual({ text: "again" });
    expect(events).toEqual([
      { type: "delta", text: "hel" },
      { type: "final", text: "hello" },
      { type: "delta", text: "aga" },
      { type: "final", text: "again" },
    ]);
    expect(socket.closed).toBe(true);
  });

  it("rejects non-24 kHz frames instead of silently resampling", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      createWebSocket: () => socket,
    });
    const session = await provider.createSession();

    await expect(session.appendAudio(frame([1], 48000))).rejects.toThrow(
      "requires 24000 Hz PCM",
    );
    await session.close();
  });

  it("closes the socket and rejects an in-flight commit when aborted", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const originalSend = socket.send.bind(socket);
    socket.send = value => {
      const event = JSON.parse(value);
      if (event.type !== "input_audio_buffer.commit") originalSend(value);
    };
    const controller = new AbortController();
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      createWebSocket: () => socket,
    });
    const session = await provider.createSession({ signal: controller.signal });
    await session.appendAudio(frame([1], 24000));

    const pending = session.commit();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(socket.closed).toBe(true);
  });

  it("rejects audio appended while a transcript commit is pending", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const originalSend = socket.send.bind(socket);
    socket.send = value => {
      const event = JSON.parse(value);
      if (event.type !== "input_audio_buffer.commit") originalSend(value);
    };
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      createWebSocket: () => socket,
    });
    const session = await provider.createSession();
    await session.appendAudio(frame([1], 24000));

    const pending = session.commit();
    await expect(session.appendAudio(frame([2], 24000))).rejects.toThrow(
      "while a transcript commit is pending",
    );
    await session.close();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("closes a socket created after session setup was aborted", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const controller = new AbortController();
    let resolveSocket: ((socket: FakeOpenAIRealtimeSocket) => void) | undefined;
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      createWebSocket: () => new Promise(resolve => {
        resolveSocket = resolve;
      }),
    });

    const pending = provider.createSession({ signal: controller.signal });
    controller.abort();
    resolveSocket?.(socket);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(socket.closed).toBe(true);
  });

  it("rejects instead of hanging when the socket is already closed", async () => {
    let closed = false;
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      createWebSocket: () => ({
        readyState: 3,
        send: () => undefined,
        close: () => {
          closed = true;
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });

    await expect(provider.createSession()).rejects.toThrow(
      "connection closed during setup",
    );
    expect(closed).toBe(true);
  });
});

describe("streaming text to speech", () => {
  it("streams OpenAI PCM chunks immediately with its documented format", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x34, 0x12, 0xfe]));
          controller.enqueue(new Uint8Array([0xff]));
          controller.close();
        },
      }));
    });
    const provider = new OpenAITextToSpeech({ apiKey: "test" });
    const iterator = provider.speak("Hello")[Symbol.asyncIterator]();

    const first = await iterator.next();
    const second = await iterator.next();

    expect(first.value).toMatchObject({
      encoding: "pcm_s16le",
      channels: 1,
      sampleRate: 24000,
    });
    expect([...first.value.samples]).toEqual([0x1234]);
    expect([...second.value.samples]).toEqual([-2]);
    expect(requestBody).toMatchObject({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: "Hello",
      response_format: "pcm",
    });
  });

  it("cancels the HTTP body read when speech is aborted", async () => {
    let bodyCancelled = false;
    setHttpRequestImpl(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0]));
      },
      cancel() {
        bodyCancelled = true;
      },
    })));
    const provider = new OpenAITextToSpeech({ apiKey: "test" });
    const controller = new AbortController();
    const iterator = provider.speak("Long response", {
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    await iterator.next();
    const pending = iterator.next();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(bodyCancelled).toBe(true);
  });

  it("requests and declares the selected ElevenLabs PCM rate", async () => {
    let requestUrl = "";
    let requestBody: any;
    setHttpRequestImpl(async (url, options) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(options.body));
      return new Response(new Uint8Array([1, 0]));
    });
    const provider = new ElevenLabsTextToSpeech({
      apiKey: "test",
      voiceId: "voice-default",
      sampleRate: 16000,
    });

    const frames = [];
    for await (const audio of provider.speak("Hello", { voice: "voice-turn" })) {
      frames.push(audio);
    }

    expect(requestUrl).toContain("/text-to-speech/voice-turn/stream");
    expect(requestUrl).toContain("output_format=pcm_16000");
    expect(requestBody).toMatchObject({
      text: "Hello",
      model_id: "eleven_multilingual_v2",
    });
    expect(provider.outputFormat).toEqual({
      encoding: "pcm_s16le",
      channels: 1,
      sampleRate: 16000,
    });
    expect(frames[0].sampleRate).toBe(16000);
  });
});
