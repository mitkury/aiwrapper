import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LiveLang,
  type LiveLangEvent,
  type LiveLangSession,
  type RealtimeSpeechWebSocketData,
} from "../../src/index.ts";

type SocketEvent = { data?: unknown; code?: number; reason?: string; wasClean?: boolean };

class Socket {
  readyState = 1;
  sent: Record<string, any>[] = [];
  listeners = new Map<string, Set<(event: SocketEvent) => void>>();
  constructor(private acknowledge = true) {}
  addEventListener(type: string, listener: (event: SocketEvent) => void) {
    const group = this.listeners.get(type) ?? new Set();
    group.add(listener);
    this.listeners.set(type, group);
  }
  removeEventListener(type: string, listener: (event: SocketEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(data: RealtimeSpeechWebSocketData) {
    const message = JSON.parse(data as string);
    this.sent.push(message);
    if (message.setup && this.acknowledge) queueMicrotask(() => this.receive({ setupComplete: {} }));
  }
  close() { this.readyState = 3; }
  receive(message: unknown) { this.emit("message", { data: JSON.stringify(message) }); }
  emit(type: string, event: SocketEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const tool = { name: "lookup", description: "Look up an object", parameters: {
  type: "object", properties: { id: { type: "string" } }, additionalProperties: false,
} };
const call = (id: string) => ({ id, name: tool.name, args: { id } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const sessions: LiveLangSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  vi.useRealTimers();
});

async function connect(socket: Socket, options: Parameters<LiveLang["connect"]>[0] = {}) {
  const session = await LiveLang.google({ apiKey: "test", createWebSocket: () => socket }).connect(options);
  sessions.push(session);
  return session;
}

describe("Gemini Live application integration", () => {
  it("preserves application setup and waits for the provider acknowledgement", async () => {
    const socket = new Socket(false);
    const config = {
      sessionResumption: { handle: "previous-session" },
      contextWindowCompression: { slidingWindow: {} },
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: false as const },
        activityHandling: "START_OF_ACTIVITY_INTERRUPTS" as const,
        turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY" as const,
      },
      mediaResolution: "MEDIA_RESOLUTION_LOW" as const,
      toolBehavior: "BLOCKING" as const,
    };
    let connected = false;
    const pending = LiveLang.google({
      apiKey: "test", model: "gemini-3.8-live", voice: "Kore", config,
      createWebSocket: () => socket,
    }).connect({ instructions: "Existing instructions", toolHandling: "manual", tools: [tool] })
      .then((session) => { connected = true; sessions.push(session); return session; });
    await settle();
    expect(connected).toBe(false);
    expect(socket.sent).toEqual([{ setup: {
      model: "models/gemini-3.8-live",
      generationConfig: {
        responseModalities: ["AUDIO"], mediaResolution: config.mediaResolution,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
      systemInstruction: { parts: [{ text: "Existing instructions" }] },
      inputAudioTranscription: {}, outputAudioTranscription: {},
      sessionResumption: config.sessionResumption,
      contextWindowCompression: config.contextWindowCompression,
      realtimeInputConfig: config.realtimeInputConfig,
      tools: [{ functionDeclarations: [{
        name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters, behavior: "BLOCKING",
      }] }],
    } }]);
    socket.receive({ setupComplete: {} });
    await pending;
    expect(connected).toBe(true);
  });

  it("sends silent context, user text, assistant history and sampled images", async () => {
    const socket = new Socket();
    const session = await connect(socket);
    await session.sendText!("[Live visual context update]", { turnComplete: false });
    await session.sendText!("What do you see?");
    await session.sendText!("Earlier answer", { role: "assistant", turnComplete: false });
    await session.appendImage!({ data: "AQID", mimeType: "image/jpeg" });
    await session.sendText!("Stop speaking", { realtime: true });
    await session.endAudio!();
    expect(socket.sent.slice(1)).toEqual([
      { clientContent: { turns: [{ role: "user", parts: [{ text: "[Live visual context update]" }] }], turnComplete: false } },
      { clientContent: { turns: [{ role: "user", parts: [{ text: "What do you see?" }] }], turnComplete: true } },
      { clientContent: { turns: [{ role: "model", parts: [{ text: "Earlier answer" }] }], turnComplete: false } },
      { realtimeInput: { video: { data: "AQID", mimeType: "image/jpeg" } } },
      { realtimeInput: { text: "Stop speaking" } },
      { realtimeInput: { audioStreamEnd: true } },
    ]);
    await expect(session.appendImage!({ data: "data:image/jpeg;base64,AQID", mimeType: "image/jpeg" }))
      .rejects.toThrow("base64 bytes");
    await expect(session.sendText!("context", { realtime: true, turnComplete: false }))
      .rejects.toThrow("activity detection");
    await session.appendAudio({ samples: new Int16Array([1]), sampleRate: 16000, channels: 1, encoding: "pcm_s16le" });
    expect(socket.sent.at(-1)).toHaveProperty("realtimeInput.audio");
    await session.close();
    await expect(session.sendText!("late")).rejects.toThrow("closed");
    await expect(session.appendImage!({ data: "AQID", mimeType: "image/png" })).rejects.toThrow("closed");
    await expect(session.sendToolResults!([])).rejects.toThrow("closed");
    await expect(session.endAudio!()).rejects.toThrow("closed");
  });

  it("leaves execution, replay and result delivery to the application in manual mode", async () => {
    const socket = new Socket();
    const events: LiveLangEvent[] = [];
    const handler = vi.fn();
    const session = await connect(socket, {
      toolHandling: "manual", tools: [{ ...tool, handler }], onEvent: (event) => events.push(event),
    });
    socket.receive({ toolCall: { functionCalls: [call("one"), call("two")] } });
    // A replay must reach the application's result cache, not vanish inside the adapter.
    socket.receive({ toolCall: { functionCalls: [call("one")] } });
    await settle();
    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-call", "tool-call"]);
    expect(handler).not.toHaveBeenCalled();
    expect(socket.sent).toHaveLength(1);
    socket.receive({ toolCallCancellation: { ids: ["one"] } });
    await settle();
    expect(events.at(-1)).toEqual({ type: "tool-calls-canceled", callIds: ["one"] });
    await session.sendToolResults!([
      { callId: "one", name: tool.name, result: { canceled: true } },
      { callId: "two", name: tool.name, result: { object: "painting" } },
    ]);
    expect(socket.sent.at(-1)).toEqual({ toolResponse: { functionResponses: [
      { id: "two", name: tool.name, response: { object: "painting" } },
    ] } });
    const sent = socket.sent.length;
    await session.sendToolResults!([{ callId: "one", name: tool.name, result: "late" }]);
    expect(socket.sent).toHaveLength(sent);
  });

  it("accepts outstanding results on a resumed connection and wraps non-object results", async () => {
    const socket = new Socket();
    const session = await connect(socket, { toolHandling: "manual", tools: [tool] });
    await session.sendToolResults!([
      { callId: "from-previous-connection", name: tool.name, result: [1, 2] },
      { callId: "another", name: tool.name, result: "done" },
    ]);
    expect(socket.sent.at(-1)).toEqual({ toolResponse: { functionResponses: [
      { id: "from-previous-connection", name: tool.name, response: { result: [1, 2] } },
      { id: "another", name: tool.name, response: { result: "done" } },
    ] } });
  });

  it("aborts canceled handlers without blocking surviving results or closing the session", async () => {
    const socket = new Socket();
    const events: LiveLangEvent[] = [];
    let canceledSignal: AbortSignal | undefined;
    let finishCanceled!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { finishCanceled = resolve; });
    const session = await connect(socket, { tools: [{ ...tool, handler: (args, context) => {
      if (args.id === "one") { canceledSignal = context.signal; return pending; }
      return "survivor";
    } }], onEvent: (event) => events.push(event) });
    socket.receive({ toolCall: { functionCalls: [call("one"), call("two")] } });
    await settle();
    socket.receive({ toolCallCancellation: { ids: ["one"] } });
    await settle();
    expect(canceledSignal?.aborted).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ toolResponse: { functionResponses: [
      { id: "two", name: tool.name, response: { result: "survivor" } },
    ] } });
    expect(socket.readyState).toBe(1);
    const sent = socket.sent.length;
    const count = events.length;
    finishCanceled("too late");
    await settle();
    expect(events).toHaveLength(count);
    expect(socket.sent).toHaveLength(sent);
    await session.sendText!("Still connected");
  });

  it("does not run a duplicate in-flight call after an interruption or turn marker", async () => {
    const socket = new Socket();
    let finish!: (value: string) => void;
    const handler = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    await connect(socket, { tools: [{ ...tool, handler }] });
    socket.receive({ toolCall: { functionCalls: [call("one")] } });
    await settle();
    socket.receive({ serverContent: { interrupted: true } });
    socket.receive({ serverContent: { turnComplete: true } });
    socket.receive({ toolCall: { functionCalls: [call("one")] } });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    finish("done");
    await settle();
  });

  it("forwards non-resumable states, expiry deadlines and provider close details", async () => {
    const socket = new Socket();
    const events: LiveLangEvent[] = [];
    await connect(socket, { onEvent: (event) => events.push(event) });
    socket.receive({ sessionResumptionUpdate: { resumable: true, newHandle: "fresh" } });
    socket.receive({ sessionResumptionUpdate: { resumable: false, newHandle: "stale" } });
    socket.receive({ goAway: { timeLeft: "1.25s" } });
    socket.receive({ goAway: { timeLeft: "invalid" } });
    await settle();
    socket.emit("close", { code: 1007, reason: "invalid argument", wasClean: false });
    expect(events.slice(0, -1)).toEqual([
      { type: "session-resumption", resumable: true, handle: "fresh" },
      { type: "session-resumption", resumable: false },
      { type: "connection-expiring", timeLeftMs: 1250 },
      { type: "connection-expiring" },
      { type: "connection-closed", code: 1007, reason: "invalid argument", wasClean: false },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { message: expect.stringContaining("1007") } });
  });

  it("reports empty turn completion, tool-only interruption and model text", async () => {
    const socket = new Socket();
    const events: LiveLangEvent[] = [];
    await connect(socket, { onEvent: (event) => events.push(event) });
    socket.receive({ serverContent: { interrupted: true } });
    socket.receive({ serverContent: { turnComplete: true } });
    socket.receive({ serverContent: { modelTurn: { parts: [
      { text: "private thought", thought: true }, { text: "Hello" },
    ] }, turnComplete: true } });
    await settle();
    expect(events).toEqual([
      { type: "response-interrupted" }, { type: "response-end" }, { type: "response-start" },
      { type: "output-transcript", transcript: { type: "delta", text: "Hello" } }, { type: "response-end" },
    ]);
  });

  it("rejects manual tools for unsupported providers before opening a socket", async () => {
    const factory = vi.fn();
    await expect(LiveLang.openai({ apiKey: "test", createWebSocket: factory })
      .connect({ toolHandling: "manual", tools: [tool] })).rejects.toThrow("manual tool handling");
    expect(factory).not.toHaveBeenCalled();
    await expect(LiveLang.mock().connect({ toolHandling: "manual" })).rejects.toThrow("manual tool handling");
    const session = await LiveLang.mock().connect();
    sessions.push(session);
    expect(session.sendText).toBeUndefined();
    expect(session.appendImage).toBeUndefined();
    expect(session.sendToolResults).toBeUndefined();
  });

  it("keeps automatic mode strict about handlers and explicit result submission", async () => {
    const socket = new Socket();
    await expect(connect(socket, { tools: [tool] })).rejects.toThrow("handlers");
    expect(socket.sent).toEqual([]);
    const session = await connect(socket);
    await expect(session.sendToolResults!([])).rejects.toThrow("manual tool handling");
  });

  it.each(["setup", "socket-factory"])("bounds a stalled %s and cleans up late sockets", async (stage) => {
    vi.useFakeTimers();
    const socket = new Socket(false);
    let release!: (socket: Socket) => void;
    const late = new Promise<Socket>((resolve) => { release = resolve; });
    const connection = LiveLang.google({
      apiKey: "test", connectTimeoutMs: 50,
      createWebSocket: () => stage === "setup" ? socket : late,
    }).connect();
    const failure = expect(connection).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await failure;
    release(socket);
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.readyState).toBe(3);
    expect([...socket.listeners.values()].every((group) => group.size === 0)).toBe(true);
  });

  it("aborts promptly while socket creation is pending", async () => {
    const controller = new AbortController();
    const socket = new Socket();
    let release!: (socket: Socket) => void;
    const connection = LiveLang.google({
      apiKey: "test", createWebSocket: () => new Promise<Socket>((resolve) => { release = resolve; }),
    }).connect({ signal: controller.signal });
    controller.abort();
    await expect(connection).rejects.toMatchObject({ name: "AbortError" });
    release(socket);
    await settle();
    expect(socket.readyState).toBe(3);
    expect(socket.sent).toEqual([]);
  });
});
