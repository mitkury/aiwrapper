import { describe, it, expect } from "vitest";
import { MockResponseStreamLang } from "../../src/lang/mock/mock-response-stream-lang.ts";

describe("MockResponseStreamLang", () => {
  it("streams multiple updates for a configured message", async () => {
    const target = "Streaming from the mock provider.";
    const lang = new MockResponseStreamLang({
      message: target,
      chunkSize: 4,
      speedMs: 0
    });

    const seenLengths: number[] = [];
    await lang.ask("Say something short", {
      onResult: (msg) => {
        if (msg.role !== "assistant") return;
        const text = msg.text;
        if (!text) return;
        seenLengths.push(text.length);
      }
    });

    expect(seenLengths.length).toBeGreaterThan(1);
    expect(seenLengths[seenLengths.length - 1]).toBe(target.length);
  });

  it("allows overriding message and streaming controls via call options", async () => {
    const lang = new MockResponseStreamLang({
      message: "Default message",
      chunkSize: 100
    });

    const overrideMessage = "Custom override from options.";
    const res = await lang.ask("Override please", {
      providerSpecificBody: {
        mockResponseStream: {
          message: overrideMessage,
          chunkSize: 5,
          speedMs: 0
        }
      }
    });

    expect(res.answer).toBe(overrideMessage);
  });

  it("rotates through preset messages when no explicit message provided", async () => {
    const presets = ["tiny", "smaller", "little"];
    const lang = new MockResponseStreamLang({
      messages: presets,
      chunkSize: 50
    });

    const first = await lang.ask("first");
    const second = await lang.ask("second");
    const third = await lang.ask("third");

    expect(first.answer).toBe("tiny");
    expect(second.answer).toBe("smaller");
    expect(third.answer).toBe("little");
  });
});
