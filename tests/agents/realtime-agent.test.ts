import { describe, expect, it, vi } from "vitest";
import { Lang } from "../../src/lang/lang.ts";
import { LanguageProvider } from "../../src/lang/language-provider.ts";
import { RealtimeAgent } from "../../src/unstable/realtime/realtime-agent.ts";
import { StreamingTextSegmenter } from "../../src/unstable/realtime/text-segmenter.ts";
import {
  SpeechToText,
  TextToSpeech,
  type PcmAudioFrame,
  type SpeechToTextProvider,
  type StreamingTextToSpeechSession,
  type TextToSpeechProvider,
} from "../../src/speech/index.ts";

const frame = (samples: number[]): PcmAudioFrame => ({
  encoding: "pcm_s16le",
  channels: 1,
  sampleRate: 24000,
  samples: new Int16Array(samples),
});

describe("StreamingTextSegmenter", () => {
  it("emits complete sentences while retaining an unfinished tail", () => {
    const segmenter = new StreamingTextSegmenter();

    expect(segmenter.push("First sentence. Sec")).toEqual(["First sentence."]);
    expect(segmenter.push("ond sentence! Tail")).toEqual(["Second sentence!"]);
    expect(segmenter.flush()).toEqual(["Tail"]);
  });

  it("bounds latency for long text without sentence punctuation", () => {
    const segmenter = new StreamingTextSegmenter({ maxBufferedCharacters: 30 });
    const segments = segmenter.push(
      "A fairly long clause, followed by words that keep going",
    );

    expect(segments).toEqual([
      "A fairly long clause,",
      "followed by words that keep",
    ]);
    expect(segmenter.flush()).toEqual(["going"]);
  });

  it("segments CJK sentence punctuation without waiting for completion", () => {
    const segmenter = new StreamingTextSegmenter();

    expect(segmenter.push("我在这里。需要什么帮助？继续")).toEqual([
      "我在这里。",
      "需要什么帮助？",
    ]);
    expect(segmenter.flush()).toEqual(["继续"]);
  });
});

describe("RealtimeAgent", () => {
  it("streams STT through the LLM into sentence-level TTS", async () => {
    const speechToText = SpeechToText.mock({ transcript: "What do you see?" });
    const textToSpeech = TextToSpeech.mock({
      frames: [new Int16Array([1, 2])],
    });
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({
        message: "I see a pump. Its status light is green.",
        chunkSize: 4,
      }),
      { speechToText, textToSpeech },
    );
    const events: string[] = [];
    const latencyStages: string[] = [];
    agent.subscribe((event) => {
      events.push(event.type);
      if (event.type === "latency") latencyStages.push(event.stage);
    });

    await agent.connect();
    agent.setImage({
      kind: "base64",
      base64: "aW1hZ2U=",
      mimeType: "image/jpeg",
    });
    await agent.sendAudio(frame([10, 20]));
    const output = await agent.commitAudio();
    await agent.close();

    expect(output.answer).toBe("I see a pump. Its status light is green.");
    expect(textToSpeech.spokenTexts).toEqual([
      "I see a pump.",
      "Its status light is green.",
    ]);
    expect(agent.messages[0].images).toEqual([
      {
        type: "image",
        base64: "aW1hZ2U=",
        mimeType: "image/jpeg",
      },
    ]);
    expect(events).toContain("audio");
    expect(events).toContain("turn_complete");
    expect(latencyStages).toEqual([
      "input_ready",
      "llm_first_token",
      "tts_input",
      "tts_first_audio",
      "turn_complete",
    ]);
    expect(agent.state).toBe("idle");
  });

  it("starts the next sentence synthesis before earlier audio completes", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];
    const textToSpeech: TextToSpeechProvider = {
      outputFormat: {
        encoding: "pcm_s16le",
        channels: 1,
        sampleRate: 24000,
      },
      async *speak(text) {
        started.push(text);
        if (text === "First sentence.") await firstReleased;
        yield frame([1]);
      },
    };
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({
        message: "First sentence. Second sentence.",
        chunkSize: 64,
      }),
      { speechToText: SpeechToText.mock(), textToSpeech },
    );

    await agent.connect();
    const response = agent.sendText("Go");
    await vi.waitFor(() => {
      expect(started).toEqual(["First sentence.", "Second sentence."]);
    });
    releaseFirst?.();
    await response;
    await agent.close();
  });

  it("feeds LLM deltas directly to streaming TTS and flushes sentence boundaries", async () => {
    const writes: Array<{ text: string; flush?: boolean }> = [];
    let finishAudio: (() => void) | undefined;
    const audioReady = new Promise<void>((resolve) => {
      finishAudio = resolve;
    });
    const session: StreamingTextToSpeechSession = {
      appendText(text) {
        writes.push({ text });
      },
      flush() {
        writes.push({ text: "", flush: true });
      },
      endInput() {
        finishAudio?.();
      },
      async close() {},
      async *[Symbol.asyncIterator]() {
        await audioReady;
        yield frame([7]);
      },
    };
    const textToSpeech: TextToSpeechProvider = {
      outputFormat: {
        encoding: "pcm_s16le",
        channels: 1,
        sampleRate: 24000,
      },
      async *speak() {
        throw new Error("sentence fallback should not be used");
      },
      async createStreamingSession() {
        return session;
      },
    };
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({
        message: "Hello there. Next thought",
        chunkSize: 4,
      }),
      { speechToText: SpeechToText.mock(), textToSpeech },
    );
    const audio: PcmAudioFrame[] = [];
    agent.subscribe((event) => {
      if (event.type === "audio") audio.push(event.frame);
    });

    await agent.connect();
    await agent.sendText("Go");
    await agent.close();

    expect(writes.map((write) => write.text).join("")).toBe(
      "Hello there. Next thought",
    );
    expect(writes.some((write) => write.flush)).toBe(true);
    expect(audio.map((value) => [...value.samples])).toEqual([[7]]);
  });

  it("reports STT finalization separately from response generation", async () => {
    const speechToText: SpeechToTextProvider = {
      inputFormat: { encoding: "pcm_s16le", channels: 1, sampleRate: 24000 },
      async createSession(options = {}) {
        return {
          async appendAudio() {},
          async commit() {
            options.onSpeechActivity?.({ type: "end" });
            const result = { text: "Hello" };
            options.onTranscript?.({ type: "final", ...result });
            return result;
          },
          async finish() {
            return this.commit();
          },
          async close() {},
        };
      },
    };
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({ message: "Hi." }),
      { speechToText, textToSpeech: TextToSpeech.mock() },
    );
    const latencyStages: string[] = [];
    agent.subscribe((event) => {
      if (event.type === "latency") latencyStages.push(event.stage);
    });

    await agent.connect();
    await agent.sendAudio(frame([1]));
    await agent.commitAudio();
    await agent.close();

    expect(latencyStages[0]).toBe("stt_final");
  });

  it("aborts current generation when explicitly interrupted", async () => {
    const textToSpeech = TextToSpeech.mock({ delayMs: 100 });
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({
        message: "A response that should be interrupted before it completes.",
        chunkSize: 2,
        speedMs: 20,
      }),
      {
        speechToText: SpeechToText.mock(),
        textToSpeech,
      },
    );
    const interrupted: string[] = [];
    agent.subscribe((event) => {
      if (event.type === "interrupted") interrupted.push(event.reason);
    });

    await agent.connect();
    const response = agent.sendText("Start talking");
    await new Promise((resolve) => setTimeout(resolve, 30));
    agent.interrupt();
    await response;
    await agent.close();

    expect(interrupted).toContain("manual");
    expect(agent.state).toBe("idle");
  });

  it("treats identical committed utterances as separate turns", async () => {
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({ message: "Still here." }),
      {
        speechToText: SpeechToText.mock({ transcript: "Hello" }),
        textToSpeech: TextToSpeech.mock(),
      },
    );

    await agent.connect();
    await agent.sendAudio(frame([1]));
    await agent.commitAudio();
    await agent.sendAudio(frame([1]));
    await agent.commitAudio();
    await agent.close();

    expect(
      agent.messages.filter((message) => message.role === "user"),
    ).toHaveLength(2);
  });

  it("keeps only the latest camera frame in model context", async () => {
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({ message: "I can see it." }),
      {
        speechToText: SpeechToText.mock(),
        textToSpeech: TextToSpeech.mock(),
      },
    );

    await agent.connect();
    agent.setImage({
      kind: "base64",
      base64: "Zmlyc3Q=",
      mimeType: "image/jpeg",
    });
    await agent.sendText("First turn");
    agent.setImage({
      kind: "base64",
      base64: "c2Vjb25k",
      mimeType: "image/jpeg",
    });
    await agent.sendText("Second turn");
    await agent.close();

    const userMessages = agent.messages.filter(
      (message) => message.role === "user",
    );
    expect(userMessages[0].images).toEqual([]);
    expect(userMessages[1].images).toEqual([
      {
        type: "image",
        base64: "c2Vjb25k",
        mimeType: "image/jpeg",
      },
    ]);
  });

  it("preserves whitespace in incremental STT transcripts", async () => {
    const speechToText: SpeechToTextProvider = {
      inputFormat: { encoding: "pcm_s16le", channels: 1, sampleRate: 24000 },
      async createSession(options = {}) {
        options.onTranscript?.({ type: "delta", text: "hello " });
        return {
          async appendAudio() {},
          async commit() {
            return { text: "" };
          },
          async finish() {
            return { text: "" };
          },
          async close() {},
        };
      },
    };
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({ message: "unused" }),
      { speechToText, textToSpeech: TextToSpeech.mock() },
    );
    const transcripts: string[] = [];
    agent.subscribe((event) => {
      if (event.type === "transcript") transcripts.push(event.text);
    });

    await agent.connect();
    await agent.close();

    expect(transcripts).toEqual(["hello "]);
  });

  it("reports an aborted lifecycle when its session signal is aborted", async () => {
    const controller = new AbortController();
    const agent = new RealtimeAgent(
      Lang.mockResponseStream({ message: "unused" }),
      {
        speechToText: SpeechToText.mock(),
        textToSpeech: TextToSpeech.mock(),
      },
    );
    const events: string[] = [];
    agent.subscribe((event) => events.push(event.type));

    await agent.connect({ signal: controller.signal });
    controller.abort();

    await expect(agent.close()).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toContain("aborted");
    expect(events).not.toContain("finished");
    expect(agent.state).toBe("idle");
  });

  it("rejects typed turns when the language provider fails", async () => {
    class FailingLanguageProvider extends LanguageProvider {
      constructor() {
        super("failing");
      }
      async ask(): Promise<never> {
        throw new Error("model unavailable");
      }
      async chat(): Promise<never> {
        throw new Error("model unavailable");
      }
    }
    const agent = new RealtimeAgent(new FailingLanguageProvider(), {
      speechToText: SpeechToText.mock(),
      textToSpeech: TextToSpeech.mock(),
    });
    const errors: string[] = [];
    agent.subscribe((event) => {
      if (event.type === "error") errors.push(event.error.message);
    });

    await agent.connect();
    await expect(agent.sendText("Hello")).rejects.toThrow("model unavailable");
    await agent.close();

    expect(errors).toEqual(["model unavailable"]);
  });
});
