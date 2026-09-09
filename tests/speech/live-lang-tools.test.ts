import { describe, expect, it } from "vitest";
import {
  executeSpeechToSpeechToolCall,
  serializeSpeechToSpeechToolResult,
} from "../../src/live/live-lang-tools.ts";
import { toolResult } from "../../src/lang/messages.ts";

describe("live tool results", () => {
  it.each([() => undefined, Symbol("result"), 1n])(
    "rejects values with no JSON representation",
    (value) => {
      expect(() => serializeSpeechToSpeechToolResult(value)).toThrow(
        "Native speech tool results must be JSON-serializable",
      );
    },
  );

  it("preserves null and normalizes an absent result to an empty object", () => {
    expect(serializeSpeechToSpeechToolResult(null)).toBe("null");
    expect(serializeSpeechToSpeechToolResult(undefined)).toBe("{}");
  });

  it("emits the same normalized result that the provider will receive", async () => {
    let serializations = 0;
    const events: unknown[] = [];
    const result = await executeSpeechToSpeechToolCall({
      tools: [{
        name: "read",
        description: "Read a value",
        parameters: { type: "object" },
        handler: () => ({ toJSON: () => ({ version: ++serializations }) }),
      }],
      onEvent: (event) => events.push(event),
    }, { callId: "call-1", name: "read", arguments: {} }, new AbortController().signal);

    expect(result.result).toEqual({ version: 1 });
    expect(serializeSpeechToSpeechToolResult(result.result)).toBe('{"version":1}');
    expect(events.at(-1)).toEqual({ type: "tool-result", result });
    expect(serializations).toBe(1);
  });

  it("returns an error to the model when a handler returns unsupported content", async () => {
    const result = await executeSpeechToSpeechToolCall({
      tools: [{
        name: "image",
        description: "Read an image",
        parameters: { type: "object" },
        handler: () => toolResult({ type: "image", base64: "aGk=" }),
      }],
    }, { callId: "call-1", name: "image", arguments: {} }, new AbortController().signal);
    expect(result.result).toMatchObject({
      error: true,
      message: "Native speech tool results do not support image content yet",
    });
  });
});
