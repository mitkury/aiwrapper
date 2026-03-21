import { describe, it, expect } from "vitest";
import { MockResponseStreamLang } from "../../src/lang/mock/mock-response-stream-lang.ts";
import { MockOpenAILikeLang } from "../../src/lang/mock/mock-openai-like-lang.ts";

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

  it("applies defaultOptions and lets per-call options override them", async () => {
    const streamed: string[] = [];
    const lang = new MockResponseStreamLang({
      defaultOptions: {
        onResult: (msg) => {
          if (msg.role === "assistant" && msg.text.length > 0) {
            streamed.push(msg.text);
          }
        },
        providerSpecificBody: {
          mockResponseStream: {
            message: "Default from defaultOptions",
            chunkSize: 3,
            speedMs: 0,
          }
        }
      }
    });

    const first = await lang.ask("Use defaults");
    const second = await lang.ask("Override defaults", {
      providerSpecificBody: {
        mockResponseStream: {
          message: "Per-call override",
          chunkSize: 50,
          speedMs: 0,
        }
      }
    });

    expect(first.answer).toBe("Default from defaultOptions");
    expect(second.answer).toBe("Per-call override");
    expect(streamed).toContain("Default from defaultOptions");
    expect(streamed[streamed.length - 1]).toBe("Per-call override");
  });

  it("applies defaultOptions in OpenAI-like providers too", async () => {
    const streamed: string[] = [];
    const lang = new MockOpenAILikeLang({
      mockResponseText: "Hello from default callback",
      chunkSize: 5,
      defaultOptions: {
        onResult: (msg) => {
          if (msg.role === "assistant" && msg.text.length > 0) {
            streamed.push(msg.text);
          }
        }
      }
    });

    const res = await lang.ask("Say hi");

    expect(res.answer).toBe("Hello from default callback");
    expect(streamed.length).toBeGreaterThan(0);
    expect(streamed[streamed.length - 1]).toBe("Hello from default callback");
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

  it("supports aborting mid-stream via signal", async () => {
    const longMessage = "lorem ipsum ".repeat(1000); // big payload
    const lang = new MockResponseStreamLang({
      message: longMessage,
      chunkSize: 50,
      speedMs: 5,
    });

    const ac = new AbortController();
    const seen: string[] = [];

    const run = lang.ask("Say something long", {
      signal: ac.signal,
      onResult: (msg) => {
        if (msg.role !== "assistant") return;
        seen.push(msg.text);
      },
    });

    setTimeout(() => ac.abort(), 10);

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].length).toBeLessThan(longMessage.length);
  });
});
