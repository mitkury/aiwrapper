import { describe, expect, it } from "vitest";
import {
  AmazonNovaSonicSpeechToSpeech,
  AzureVoiceLiveSpeechToSpeech,
  GeminiLiveSpeechToSpeech,
  MockSpeechToSpeech,
  OpenAIRealtimeSpeechToSpeech,
  SpeechToSpeech,
  XAIVoiceSpeechToSpeech,
  createSpeechToSpeechTimeline,
  type PcmAudioFrame,
  type RealtimeSpeechWebSocketData,
  type SpeechToSpeechEvent,
  type LangTool,
} from "../../src/index.ts";
import { parseSpeechToSpeechToolCall } from "../../src/live/live-lang-tools.ts";

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
  it("rejects malformed provider tool arguments instead of inventing them", () => {
    expect(parseSpeechToSpeechToolCall("call-1", "noop", undefined)).toEqual({
      callId: "call-1",
      name: "noop",
      arguments: {},
    });
    expect(() =>
      parseSpeechToSpeechToolCall("call-1", "add", "not json")
    ).toThrow('Live tool "add" returned invalid JSON arguments');
    expect(() =>
      parseSpeechToSpeechToolCall("call-1", "add", [1, 2])
    ).toThrow('Live tool "add" arguments must be a JSON object');
  });

  it("uses LangTool and emits normalized calls and results", async () => {
    const contexts: unknown[] = [];
    const tools: LangTool[] = [{
      name: "add",
      description: "Add two numbers",
      parameters: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
      handler: ({ a, b }, context) => {
        contexts.push(context);
        return Number(a) + Number(b);
      },
    }];
    const events: SpeechToSpeechEvent[] = [];
    const completed = deferred<void>();
    const session = await SpeechToSpeech.mock({
      toolCalls: [{
        callId: "call-add",
        name: "add",
        arguments: { a: 2, b: 3 },
      }],
    }).createSession({
      tools,
      onEvent(event) {
        events.push(event);
        if (event.type === "response-end") completed.resolve();
      },
    });

    await session.appendAudio(frame([1], 24000));
    await completed.promise;

    expect(events).toContainEqual({
      type: "tool-call",
      call: {
        callId: "call-add",
        name: "add",
        arguments: { a: 2, b: 3 },
      },
    });
    expect(events).toContainEqual({
      type: "tool-result",
      result: { callId: "call-add", name: "add", result: 5 },
    });
    expect(contexts).toMatchObject([{
      callId: "call-add",
      name: "add",
      signal: expect.any(AbortSignal),
    }]);
    await session.close();
  });

  it("rejects provider-managed tools that cannot share local handlers", async () => {
    await expect(
      SpeechToSpeech.mock().createSession({
        tools: [{ name: "web_search" }],
      }),
    ).rejects.toThrow(
      "Native speech sessions only support local function tools with handlers",
    );
  });

  it("records tool calls and results in the shared timeline", () => {
    const timeline = createSpeechToSpeechTimeline();

    expect(timeline.record({
      type: "tool-call",
      call: { callId: "call-1", name: "add", arguments: { a: 1 } },
    }, 100)).toEqual([
      { turnId: 1, stage: "tool-call", milliseconds: 0 },
    ]);
    expect(timeline.record({
      type: "tool-result",
      result: { callId: "call-1", name: "add", result: 2 },
    }, 125)).toEqual([
      { turnId: 1, stage: "tool-result", milliseconds: 25 },
    ]);
  });

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
  it("executes shared tools and returns function outputs before continuing", async () => {
    const socket = new FakeLiveSocket({ type: "session.updated" });
    const events: SpeechToSpeechEvent[] = [];
    const session = await SpeechToSpeech.openaiRealtime({
      apiKey: "test",
      createWebSocket: () => socket,
    }).createSession({
      tools: [weatherTool()],
      onEvent: (event) => events.push(event),
    });

    expect(socket.sent[0]).toMatchObject({
      session: {
        tools: [{
          type: "function",
          name: "get_weather",
          description: "Get current weather",
          parameters: { type: "object" },
        }],
        tool_choice: "auto",
      },
    });
    socket.serverMessage({ type: "response.created" });
    socket.serverMessage({
      type: "response.function_call_arguments.done",
      call_id: "call-weather",
      name: "get_weather",
      arguments: '{"location":"Paris"}',
    });
    socket.serverMessage({
      type: "response.done",
      response: { status: "completed" },
    });
    await settleMessages();

    expect(events).toContainEqual({
      type: "tool-call",
      call: {
        callId: "call-weather",
        name: "get_weather",
        arguments: { location: "Paris" },
      },
    });
    expect(events).toContainEqual({
      type: "tool-result",
      result: {
        callId: "call-weather",
        name: "get_weather",
        result: { location: "Paris", temperature: 21 },
      },
    });
    expect(socket.sent.slice(-2)).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call-weather",
          output: '{"location":"Paris","temperature":21}',
        },
      },
      { type: "response.create" },
    ]);
    expect(events.some((event) => event.type === "response-end")).toBe(false);

    socket.serverMessage({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-weather",
        name: "get_weather",
        arguments: '{"location":"Paris"}',
      },
    });
    socket.serverMessage({
      type: "response.done",
      response: { status: "completed" },
    });
    await settleMessages();
    expect(
      events.filter((event) => event.type === "tool-call"),
    ).toHaveLength(1);
    expect(
      socket.sent.filter((message) =>
        message.type === "conversation.item.create"
      ),
    ).toHaveLength(1);
    await session.close();
  });

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
      tools: [weatherTool()],
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
      tools: [weatherTool()],
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
        tools: [{
          type: "function",
          name: "get_weather",
          description: "Get current weather",
          parameters: weatherTool().parameters,
        }],
        tool_choice: "auto",
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
  it("maps shared tools to Nova tool configuration and tool results", async () => {
    const outputs = new PushAsyncIterable<unknown>();
    const inputs: Record<string, any>[] = [];
    const events: SpeechToSpeechEvent[] = [];
    const session = await SpeechToSpeech.amazonNovaSonic({
      invoke: async ({ body }) => {
        void (async () => {
          for await (const message of body) {
            inputs.push(
              JSON.parse(new TextDecoder().decode(message.chunk.bytes)),
            );
          }
        })();
        return { body: outputs };
      },
    }).createSession({
      tools: [weatherTool()],
      onEvent: (event) => events.push(event),
    });
    await settleMessages();

    expect(inputs[1]).toMatchObject({
      event: {
        promptStart: {
          toolUseOutputConfiguration: { mediaType: "application/json" },
          toolConfiguration: {
            tools: [{
              toolSpec: {
                name: "get_weather",
                description: "Get current weather",
                inputSchema: { json: { type: "object" } },
              },
            }],
            toolChoice: { auto: {} },
          },
        },
      },
    });
    outputs.push(novaEvent({
      toolUse: {
        promptName: "prompt-1",
        contentId: "content-1",
        toolUseId: "nova-weather",
        toolName: "get_weather",
        content: '{"location":"Paris"}',
      },
    }));
    await settleMessages();
    await settleMessages();

    expect(events.map((event) => event.type)).toEqual([
      "tool-call",
      "tool-result",
    ]);
    expect(inputs.at(-1)).toEqual({
      event: {
        toolResult: {
          promptName: "prompt-1",
          contentName: "content-1",
          content: '{"location":"Paris","temperature":21}',
        },
      },
    });
    await session.close();
  });

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
      tools: [weatherTool()],
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
      tools: [weatherTool()],
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
        tools: [{
          type: "function",
          name: "get_weather",
          description: "Get current weather",
          parameters: weatherTool().parameters,
        }],
        tool_choice: "auto",
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
  it("maps the shared tools to Live function calls and responses", async () => {
    const socket = new FakeLiveSocket({ setupComplete: {} });
    const events: SpeechToSpeechEvent[] = [];
    const session = await SpeechToSpeech.geminiLive({
      apiKey: "test",
      createWebSocket: () => socket,
    }).createSession({
      tools: [weatherTool()],
      onEvent: (event) => events.push(event),
    });

    expect(socket.sent[0]).toMatchObject({
      setup: {
        tools: [{
          functionDeclarations: [{
            name: "get_weather",
            description: "Get current weather",
            parameters: { type: "object" },
          }],
        }],
      },
    });
    const toolCall = {
      toolCall: {
        functionCalls: [{
          id: "gemini-weather",
          name: "get_weather",
          args: { location: "Paris" },
        }],
      },
    };
    socket.serverMessage(toolCall);
    socket.serverMessage(toolCall);
    await settleMessages();

    expect(events.map((event) => event.type)).toEqual([
      "tool-call",
      "tool-result",
    ]);
    expect(socket.sent.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [{
          id: "gemini-weather",
          name: "get_weather",
          response: {
            result: { location: "Paris", temperature: 21 },
          },
        }],
      },
    });
    expect(socket.sent.filter((message) => message.toolResponse)).toHaveLength(
      1,
    );
    await session.close();
  });

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

function weatherTool(): LangTool {
  return {
    name: "get_weather",
    description: "Get current weather",
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
    handler: ({ location }) => ({ location, temperature: 21 }),
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
