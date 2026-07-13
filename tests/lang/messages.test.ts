import { describe, expect, it } from "vitest";
import { LangMessages, type LangTool } from "../../src/lang/messages.ts";

describe("LangMessages image inputs", () => {
  it("encodes byte images without the Node.js Buffer global", () => {
    const runtime = globalThis as typeof globalThis & {
      Buffer?: typeof Buffer;
    };
    const originalBuffer = runtime.Buffer;

    try {
      runtime.Buffer = undefined;

      const messages = new LangMessages();
      messages.addUserImages({
        kind: "bytes",
        bytes: new Uint8Array([104, 105]),
        mimeType: "text/plain",
      });

      expect(messages.userImages).toEqual([
        {
          type: "image",
          base64: "aGk=",
          mimeType: "text/plain",
        },
      ]);
    } finally {
      runtime.Buffer = originalBuffer;
    }
  });
});

describe("LangMessages copying", () => {
  it("preserves conversation state and tools", () => {
    const tools: LangTool[] = [{
      name: "clock",
      description: "Read the clock",
      parameters: { type: "object" },
      handler: () => "12:00",
    }];
    const source = new LangMessages("What time is it?", { tools });
    source.instructions = "Be concise";
    source.finished = true;
    source.aborted = true;

    const copy = new LangMessages(source);

    expect(copy).not.toBe(source);
    expect(copy[0]).toBe(source[0]);
    expect(copy.availableTools).toBe(tools);
    expect(copy.instructions).toBe("Be concise");
    expect(copy.finished).toBe(true);
    expect(copy.aborted).toBe(true);
  });

  it("allows copied tools to be overridden", () => {
    const source = new LangMessages("Hello", {
      tools: [{ name: "provider-tool" }],
    });
    const replacement: LangTool[] = [{ name: "replacement-tool" }];

    const copy = new LangMessages(source, { tools: replacement });

    expect(copy.availableTools).toBe(replacement);
  });
});

describe("LangMessages tool execution", () => {
  it("returns null when the last assistant message has no tool request", async () => {
    const messages = new LangMessages();
    messages.addAssistantMessage("No tools needed");

    await expect(messages.executeRequestedTools()).resolves.toBeNull();
    expect(messages).toHaveLength(1);
  });

  it("normalizes thrown tool values", async () => {
    const messages = new LangMessages("Run the tool", {
      tools: [{
        name: "fail",
        description: "Fail",
        parameters: { type: "object" },
        handler: () => {
          throw "plain failure";
        },
      }],
    });
    messages.addAssistantItems([{
      type: "tool",
      name: "fail",
      callId: "call-1",
      arguments: {},
    }]);

    const result = await messages.executeRequestedTools();

    expect(result?.toolResults).toEqual([{
      type: "tool-result",
      name: "fail",
      callId: "call-1",
      result: {
        error: true,
        name: "Error",
        message: "plain failure",
      },
    }]);
  });
});
