import { describe, expect, it, vi } from "vitest";
import {
  fixToolResultsIfNeeded,
  LangMessage,
  LangMessages,
  normalizeLangToolResultImage,
  toolResult,
  type LangTool,
} from "../../src/lang/messages.ts";

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
  it.each([null, false, 0, [], {}, { amount: "5" }, { amount: -1 }, { amount: 5, extra: true }].map(args => ({ args })))(
    "rejects invalid arguments $args before running a handler",
    async ({ args }) => {
      const handler = vi.fn(() => "paid");
      const messages = new LangMessages("Pay", {
        tools: [{
          name: "pay",
          description: "Pay an amount",
          parameters: {
            type: "object",
            properties: { amount: { type: "integer", minimum: 1 } },
            required: ["amount"],
            additionalProperties: false,
          },
          handler,
        }],
      });
      messages.addAssistantItems([{
        type: "tool", name: "pay", callId: "payment", arguments: args as any,
      }]);

      const result = await messages.executeRequestedTools();

      expect(handler).not.toHaveBeenCalled();
      expect(result?.toolResults[0]).toMatchObject({
        callId: "payment", name: "pay", result: { error: true },
      });
    },
  );

  it.each([false, true])("rejects duplicate call IDs before side effects (previous turn: %s)", async (previousTurn) => {
    const handler = vi.fn(() => "done");
    const messages = new LangMessages("Run", {
      tools: [{ name: "work", description: "Work", parameters: {}, handler }],
    });
    const call = { type: "tool" as const, name: "work", callId: "duplicate", arguments: {} };
    if (previousTurn) {
      messages.addAssistantItems([call]);
      messages.addToolResultsMessage([{
        type: "tool-result", callId: call.callId, name: call.name, result: "already done",
      }]);
      messages.addUserMessage("Continue");
    }
    messages.addAssistantItems(previousTurn
      ? [{ ...call, callId: "new-call" }, call]
      : [call, call]);

    await expect(messages.executeRequestedTools()).rejects.toThrow("duplicate tool call");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { fails: false, later: false },
    { fails: true, later: false },
    { fails: false, later: true },
    { fails: true, later: true },
  ])("retains the actual outcome when cancellation races completion: %j", async ({ fails, later }) => {
    const controller = new AbortController();
    const handler = vi.fn(() => {
      controller.abort();
      if (fails) throw new Error("write failed");
      return { saved: true };
    });
    const messages = new LangMessages("Save", {
      tools: [{ name: "save", description: "Save", parameters: {}, handler }],
    });
    messages.addAssistantItems([
      { type: "tool", name: "save", callId: "first", arguments: {} },
      ...(later ? [{ type: "tool" as const, name: "save", callId: "later", arguments: {} }] : []),
    ]);

    await expect(messages.executeRequestedTools({ signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError", partialResult: messages });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(messages.aborted).toBe(true);
    expect(messages.at(-1)?.toolResults).toEqual([{
      type: "tool-result", callId: "first", name: "save",
      result: fails
        ? { error: true, name: "Error", message: "write failed" }
        : { saved: true },
    }]);
  });

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

  it("passes call metadata and the turn signal to handlers", async () => {
    const controller = new AbortController();
    let receivedContext: unknown;
    const messages = new LangMessages("Run the tool", {
      tools: [{
        name: "inspect",
        description: "Inspect context",
        parameters: { type: "object" },
        handler: (_args, context) => {
          receivedContext = context;
          return "done";
        },
      }],
    });
    messages.addAssistantItems([{
      type: "tool",
      name: "inspect",
      callId: "call-context",
      arguments: {},
    }]);

    await messages.executeRequestedTools({ signal: controller.signal });

    expect(receivedContext).toEqual({
      callId: "call-context",
      name: "inspect",
      signal: controller.signal,
    });
  });

  it("uses request tools without mutating conversation tools", async () => {
    const conversationTool: LangTool = {
      name: "conversation-tool",
      description: "Conversation tool",
      parameters: { type: "object" },
      handler: () => "wrong",
    };
    const requestTool: LangTool = {
      name: "request-tool",
      description: "Request tool",
      parameters: { type: "object" },
      handler: () => "right",
    };
    const messages = new LangMessages("Run the tool", {
      tools: [conversationTool],
    });
    messages.addAssistantItems([{
      type: "tool",
      name: "request-tool",
      callId: "call-request",
      arguments: {},
    }]);

    const result = await messages.executeRequestedTools({ tools: [requestTool] });

    expect(result?.toolResults[0].result).toBe("right");
    expect(messages.availableTools).toEqual([conversationTool]);
  });

  it("propagates tool cancellation instead of returning it to the model", async () => {
    const controller = new AbortController();
    const messages = new LangMessages("Run the tool", {
      tools: [{
        name: "wait",
        description: "Wait",
        parameters: { type: "object" },
        handler: (_args, context) => new Promise((_resolve, reject) => {
          context.signal?.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        }),
      }],
    });
    messages.addAssistantItems([{
      type: "tool",
      name: "wait",
      callId: "call-wait",
      arguments: {},
    }]);

    const pending = messages.executeRequestedTools({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(messages.aborted).toBe(true);
    expect(messages.some(message => message.role === "tool-results")).toBe(false);
  });

  it("preserves explicit multimodal tool content", async () => {
    const content = toolResult({
      type: "image",
      bytes: new Uint8Array([104, 105]),
      mimeType: "image/jpeg",
    });
    const messages = new LangMessages("Use the camera", {
      tools: [{
        name: "camera",
        description: "Capture a frame",
        parameters: { type: "object" },
        handler: () => content,
      }],
    });
    messages.addAssistantItems([{
      type: "tool",
      name: "camera",
      callId: "call-camera",
      arguments: {},
    }]);

    const result = await messages.executeRequestedTools();

    expect(result?.toolResults[0].result).toBe(content);
    const image = content.content[0];
    expect(image.type).toBe("image");
    if (image.type === "image") {
      expect(normalizeLangToolResultImage(image)).toEqual({
        kind: "base64",
        base64: "aGk=",
        mimeType: "image/jpeg",
      });
    }
  });

  it("retains completed tool results and partial history when a later call aborts", async () => {
    const messages = new LangMessages("Run both tools", {
      tools: [{
        name: "work",
        description: "Complete or cancel work",
        parameters: { type: "object" },
        handler: ({ cancel }) => {
          if (cancel) throw { name: "AbortError", message: "Stopped" };
          return { saved: true };
        },
      }],
    });
    messages.addAssistantItems([
      { type: "tool", name: "work", callId: "saved", arguments: {} },
      { type: "tool", name: "work", callId: "cancelled", arguments: { cancel: true } },
    ]);

    await expect(messages.executeRequestedTools()).rejects.toMatchObject({
      name: "AbortError",
      partialResult: messages,
    });

    expect(messages.aborted).toBe(true);
    expect(messages.at(-1)?.toolResults).toEqual([{
      type: "tool-result", name: "work", callId: "saved", result: { saved: true },
    }]);
    fixToolResultsIfNeeded(messages);
    expect(messages.at(-1)?.toolResults.map((item) => item.result)).toEqual([
      { saved: true }, "aborted",
    ]);
  });
});

describe("fixToolResultsIfNeeded", () => {
  it("fills in results missing from a partial tool-results message", () => {
    const messages = new LangMessages([
      new LangMessage("assistant", [
        {
          type: "tool",
          name: "first",
          callId: "call-1",
          arguments: {},
        },
        {
          type: "tool",
          name: "second",
          callId: "call-2",
          arguments: {},
        },
      ]),
      new LangMessage("tool-results", [{
        type: "tool-result",
        name: "first",
        callId: "call-1",
        result: "done",
      }]),
    ]);

    fixToolResultsIfNeeded(messages);

    expect(messages).toHaveLength(2);
    expect(messages[1].toolResults).toEqual([
      {
        type: "tool-result",
        name: "first",
        callId: "call-1",
        result: "done",
      },
      {
        type: "tool-result",
        name: "second",
        callId: "call-2",
        result: "aborted",
      },
    ]);
  });
});
