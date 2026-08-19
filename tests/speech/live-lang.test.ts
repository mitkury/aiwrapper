import { describe, expect, it } from "vitest";
import {
  LiveLang,
  type LiveLangEvent,
  type LiveLangSession,
} from "../../src/index.ts";

describe("LiveLang", () => {
  it("connects a persistent model and exposes its audio formats", async () => {
    const live = LiveLang.mock({
      inputSampleRate: 16000,
      outputSampleRate: 24000,
      outputTranscript: "hello",
    });
    const events: LiveLangEvent[] = [];

    expect(live.inputFormat.sampleRate).toBe(16000);
    expect(live.outputFormat.sampleRate).toBe(24000);

    const session: LiveLangSession = await live.connect({
      onEvent: (event) => events.push(event),
    });
    const completed = new Promise<void>((resolve) => {
      session.addEventListener("response-end", () => resolve());
    });

    await session.appendAudio({
      encoding: "pcm_s16le",
      channels: 1,
      sampleRate: live.inputFormat.sampleRate,
      samples: new Int16Array([1]),
    });
    await completed;

    expect(events.map((event) => event.type)).toEqual([
      "response-start",
      "output-audio",
      "output-transcript",
      "response-end",
    ]);
    await session.close();
  });

  it("accepts a custom provider through the same connection lifecycle", async () => {
    const optionsSeen: unknown[] = [];
    const format = {
      encoding: "pcm_s16le" as const,
      channels: 1 as const,
      sampleRate: 8000,
    };
    const session: LiveLangSession = {
      appendAudio: async () => undefined,
      close: async () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const live = new LiveLang({
      inputFormat: format,
      outputFormat: format,
      async createSession(options) {
        optionsSeen.push(options);
        return session;
      },
    });

    await expect(live.connect({ instructions: "Be brief." })).resolves.toBe(
      session,
    );
    expect(optionsSeen).toMatchObject([{ instructions: "Be brief." }]);
  });
});
