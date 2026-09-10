import { afterEach, describe, expect, it } from "vitest";
import { setHttpRequestImpl } from "../../src/http-request.ts";
import {
  ElevenLabsTextToSpeech,
  ElevenLabsRealtimeSpeechToText,
  DeepgramFluxSpeechToText,
  MockSpeechToText,
  MockTextToSpeech,
  OpenAIRealtimeSpeechToText,
  OpenAISpeechToText,
  OpenAITextToSpeech,
  type PcmAudioFrame,
  type RealtimeSpeechWebSocketData,
} from "../../src/speech/index.ts";

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

  send(value: RealtimeSpeechWebSocketData): void {
    if (typeof value !== "string")
      throw new Error("Expected an OpenAI JSON message");
    const event = JSON.parse(value);
    this.sent.push(event);
    if (event.type === "session.update") {
      queueMicrotask(() => this.serverMessage({ type: "session.updated" }));
    }
    if (event.type === "input_audio_buffer.append") {
      queueMicrotask(() =>
        this.serverMessage({
          type: "conversation.item.input_audio_transcription.delta",
          delta: this.turn === 0 ? "hel" : "aga",
        }),
      );
    }
    if (event.type === "input_audio_buffer.commit") {
      const transcript = this.turn === 0 ? "hello" : "again";
      this.turn++;
      queueMicrotask(() =>
        this.serverMessage({
          type: "conversation.item.input_audio_transcription.completed",
          transcript,
        }),
      );
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

class FakeRealtimeSpeechSocket {
  readonly sent: RealtimeSpeechWebSocketData[] = [];
  readyState = 0;
  closed = false;
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

  send(value: RealtimeSpeechWebSocketData): void {
    this.sent.push(value);
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

const nativeFetch = globalThis.fetch;

afterEach(() => {
  setHttpRequestImpl((url, options) => nativeFetch(url, options));
});

const frame = (samples: number[], sampleRate = 16000): PcmAudioFrame => ({
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate,
  samples: new Int16Array(samples),
});

describe("speech mocks", () => {
  it("keeps the STT session shape used by batch and streaming providers", async () => {
    const events: unknown[] = [];
    const provider = new MockSpeechToText({
      transcript: (frames) => `${frames[0].samples.length} samples`,
      languages: ["en"],
    });
    const session = await provider.createSession({
      onTranscript: (event) => events.push(event),
    });

    await session.appendAudio(frame([1, 2, 3]));
    const result = await session.finish();

    expect(result).toEqual({ text: "3 samples", languages: ["en"] });
    expect(events).toEqual([
      {
        type: "final",
        text: "3 samples",
        languages: ["en"],
      },
    ]);
  });

  it("makes mock STT enforce the real providers' per-turn sample-rate rule", async () => {
    const session = await new MockSpeechToText().createSession();
    await session.appendAudio(frame([1], 16000));

    await expect(session.appendAudio(frame([2], 24000))).rejects.toThrow(
      "without resampling",
    );

    await session.commit();
    await expect(
      session.appendAudio(frame([3], 24000)),
    ).resolves.toBeUndefined();
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
    expect(
      frames.map((audio) => ({
        encoding: audio.encoding,
        channels: audio.channels,
        sampleRate: audio.sampleRate,
        samples: [...audio.samples],
      })),
    ).toEqual([
      {
        encoding: "pcm_s16le",
        channels: 1,
        sampleRate: 24000,
        samples: [1, -2],
      },
      { encoding: "pcm_s16le", channels: 1, sampleRate: 24000, samples: [3] },
    ]);
  });

  it("stops mock TTS promptly when aborted", async () => {
    const provider = new MockTextToSpeech({ delayMs: 1000 });
    const controller = new AbortController();
    const iterator = provider
      .speak("Cancelled clause", {
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();

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
      return new Response(
        JSON.stringify({
          text: "hello",
          languages: [{ code: "en" }],
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
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
      onTranscript: (event) => events.push(event),
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
              model: "gpt-4o-mini-transcribe",
              prompt: "AIWrapper voice test",
            },
            turn_detection: null,
          },
        },
      },
    });
    expect(
      socket.sent.filter((event) => event.type === "input_audio_buffer.append"),
    ).toEqual([
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

  it("forwards provider VAD activity", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const activity: unknown[] = [];
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      turnDetection: {
        type: "server_vad",
        silence_duration_ms: 350,
      },
      noiseReduction: { type: "near_field" },
      createWebSocket: () => socket,
    });
    const session = await provider.createSession({
      onSpeechActivity: (event) => activity.push(event),
    });

    socket.serverMessage({
      type: "input_audio_buffer.speech_started",
      audio_start_ms: 120,
    });
    socket.serverMessage({
      type: "input_audio_buffer.speech_stopped",
      audio_end_ms: 940,
    });
    await Promise.resolve();

    expect(socket.sent[0].session.audio.input).toMatchObject({
      turn_detection: {
        type: "server_vad",
        silence_duration_ms: 350,
      },
      noise_reduction: { type: "near_field" },
    });
    expect(activity).toEqual([
      { type: "start", audioOffsetMs: 120 },
      { type: "end", audioOffsetMs: 940 },
    ]);
    await session.close();
  });

  it("uses local VAD to commit gpt-live-transcribe turns", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const activity: unknown[] = [];
    const provider = new OpenAIRealtimeSpeechToText({
      apiKey: "test",
      model: "gpt-live-transcribe",
      language: "en",
      delay: "minimal",
      turnDetection: {
        type: "local_vad",
        threshold: 0.01,
        silence_duration_ms: 300,
      },
      createWebSocket: () => socket,
    });
    const session = await provider.createSession({
      onSpeechActivity: (event) => activity.push(event),
    });
    const silence = frame(new Array(2400).fill(0), 24000);
    const speech = frame(new Array(2400).fill(1000), 24000);

    await session.appendAudio(silence);
    await session.appendAudio(speech);
    await session.appendAudio(silence);
    await session.appendAudio(silence);
    await session.appendAudio(silence);
    await Promise.resolve();

    expect(socket.sent[0].session.audio.input).toMatchObject({
      transcription: {
        model: "gpt-live-transcribe",
        languages: ["en"],
        delay: "minimal",
      },
      turn_detection: null,
    });
    expect(
      socket.sent.filter((event) => event.type === "input_audio_buffer.append"),
    ).toHaveLength(4);
    expect(
      socket.sent.filter((event) => event.type === "input_audio_buffer.commit"),
    ).toHaveLength(1);
    expect(activity).toEqual([{ type: "start" }, { type: "end" }]);
    await session.close();
  });

  it("closes the socket and rejects an in-flight commit when aborted", async () => {
    const socket = new FakeOpenAIRealtimeSocket();
    const originalSend = socket.send.bind(socket);
    socket.send = (value) => {
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
    socket.send = (value) => {
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
      createWebSocket: () =>
        new Promise((resolve) => {
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

describe("Deepgram Flux speech to text", () => {
  it("streams raw PCM and finalizes turns from Flux events", async () => {
    const socket = new FakeRealtimeSpeechSocket();
    const transcripts: unknown[] = [];
    const activity: unknown[] = [];
    let connection:
      { url: string; headers: Record<string, string> } | undefined;
    const provider = new DeepgramFluxSpeechToText({
      apiKey: "deepgram-test",
      model: "flux-general-multi",
      languageHints: ["en", "fr"],
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        return socket;
      },
    });
    const session = await provider.createSession({
      onTranscript: (event) => transcripts.push(event),
      onSpeechActivity: (event) => activity.push(event),
    });

    await session.appendAudio(frame([0x1234, -2], 24000));
    const committed = session.commit();
    socket.serverMessage({ event: "StartOfTurn", transcript: "hello" });
    socket.serverMessage({ event: "Update", transcript: "hello world" });
    socket.serverMessage({
      event: "EndOfTurn",
      transcript: "hello world",
      languages: ["en"],
    });
    const result = await committed;
    await session.close();

    const url = new URL(connection?.url ?? "");
    expect(url.origin + url.pathname).toBe("wss://api.deepgram.com/v2/listen");
    expect(url.searchParams.get("model")).toBe("flux-general-multi");
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("24000");
    expect(url.searchParams.getAll("language_hint")).toEqual(["en", "fr"]);
    expect(connection?.headers).toEqual({
      Authorization: "Token deepgram-test",
    });
    expect([...new Uint8Array(socket.sent[0] as Uint8Array)]).toEqual([
      0x34, 0x12, 0xfe, 0xff,
    ]);
    expect(transcripts).toEqual([
      { type: "delta", text: "hello" },
      { type: "delta", text: " world" },
      { type: "final", text: "hello world", languages: ["en"] },
    ]);
    expect(activity).toEqual([{ type: "start" }, { type: "end" }]);
    expect(result).toEqual({ text: "hello world", languages: ["en"] });
  });
});

describe("ElevenLabs realtime speech to text", () => {
  it("streams PCM messages and uses committed transcripts as turns", async () => {
    const socket = new FakeRealtimeSpeechSocket();
    const transcripts: unknown[] = [];
    const activity: unknown[] = [];
    let connection:
      { url: string; headers: Record<string, string> } | undefined;
    const provider = new ElevenLabsRealtimeSpeechToText({
      apiKey: "eleven-test",
      vadSilenceThresholdSeconds: 0.35,
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        setTimeout(
          () =>
            socket.serverMessage({
              message_type: "session_started",
              session_id: "session-1",
            }),
          0,
        );
        return socket;
      },
    });
    const session = await provider.createSession({
      onTranscript: (event) => transcripts.push(event),
      onSpeechActivity: (event) => activity.push(event),
    });

    await session.appendAudio(frame([0x1234, -2], 24000));
    const committed = session.commit();
    socket.serverMessage({ message_type: "partial_transcript", text: "hello" });
    socket.serverMessage({
      message_type: "partial_transcript",
      text: "hello world",
    });
    socket.serverMessage({
      message_type: "committed_transcript",
      text: "hello world",
      language_code: "en",
    });
    const result = await committed;
    await session.close();

    const url = new URL(connection?.url ?? "");
    expect(url.origin + url.pathname).toBe(
      "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    );
    expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(url.searchParams.get("audio_format")).toBe("pcm_24000");
    expect(url.searchParams.get("commit_strategy")).toBe("vad");
    expect(url.searchParams.get("vad_silence_threshold_secs")).toBe("0.35");
    expect(connection?.headers).toEqual({ "xi-api-key": "eleven-test" });
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      message_type: "input_audio_chunk",
      audio_base_64: "NBL+/w==",
    });
    expect(transcripts).toEqual([
      { type: "delta", text: "hello" },
      { type: "delta", text: " world" },
      { type: "final", text: "hello world", languages: ["en"] },
    ]);
    expect(activity).toEqual([{ type: "start" }, { type: "end" }]);
    expect(result).toEqual({ text: "hello world", languages: ["en"] });
  });
});

describe("streaming text to speech", () => {
  it("streams OpenAI PCM chunks immediately with its documented format", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0x34, 0x12, 0xfe]));
            controller.enqueue(new Uint8Array([0xff]));
            controller.close();
          },
        }),
      );
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
    setHttpRequestImpl(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([0, 0]));
            },
            cancel() {
              bodyCancelled = true;
            },
          }),
        ),
    );
    const provider = new OpenAITextToSpeech({ apiKey: "test" });
    const controller = new AbortController();
    const iterator = provider
      .speak("Long response", {
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();

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
    for await (const audio of provider.speak("Hello", {
      voice: "voice-turn",
    })) {
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

  it("streams incremental text and PCM over one ElevenLabs WebSocket", async () => {
    const socket = new FakeRealtimeSpeechSocket();
    let connection:
      { url: string; headers: Record<string, string> } | undefined;
    const provider = new ElevenLabsTextToSpeech({
      apiKey: "test",
      voiceId: "voice-default",
      model: "eleven_flash_v2_5",
      sampleRate: 24000,
      chunkLengthSchedule: [50, 80],
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        return socket;
      },
    });

    const session = await provider.createStreamingSession();
    session.appendText("Hello ");
    session.appendText("there.");
    session.flush();
    session.endInput();
    const audio = session[Symbol.asyncIterator]();
    socket.serverMessage({
      audio: btoa(String.fromCharCode(0x34, 0x12, 0xfe, 0xff)),
      is_final: false,
    });
    socket.serverMessage({ is_final: true });

    const first = await audio.next();
    expect(first).toMatchObject({
      done: false,
      value: { sampleRate: 24000, channels: 1 },
    });
    expect(await audio.next()).toEqual({ value: undefined, done: true });
    const sent = socket.sent.map((value) => JSON.parse(String(value)));
    expect(connection?.url).toContain(
      "/text-to-speech/voice-default/stream-input",
    );
    expect(connection?.url).toContain("model_id=eleven_flash_v2_5");
    expect(connection?.headers).toEqual({ "xi-api-key": "test" });
    expect(sent).toEqual([
      {
        text: " ",
        generation_config: { chunk_length_schedule: [50, 80] },
      },
      { text: "Hello " },
      { text: "there." },
      { text: " ", flush: true },
      { text: "" },
    ]);
    expect(first.done ? [] : [...first.value.samples]).toEqual([0x1234, -2]);
    await session.close();
    expect(socket.closed).toBe(true);
  });

  it("uses a browser-safe ElevenLabs token and aborts a pending stream", async () => {
    const socket = new FakeRealtimeSpeechSocket();
    const controller = new AbortController();
    let connection:
      { url: string; headers: Record<string, string> } | undefined;
    const provider = new ElevenLabsTextToSpeech({
      singleUseToken: "short-lived",
      voiceId: "voice",
      createWebSocket: (url, headers) => {
        connection = { url, headers };
        return socket;
      },
    });
    const session = await provider.createStreamingSession({
      signal: controller.signal,
    });
    const pendingAudio = session[Symbol.asyncIterator]().next();

    controller.abort();

    await expect(pendingAudio).rejects.toMatchObject({ name: "AbortError" });
    expect(connection?.url).toContain("single_use_token=short-lived");
    expect(connection?.headers).toEqual({});
    expect(socket.closed).toBe(true);
  });
});
