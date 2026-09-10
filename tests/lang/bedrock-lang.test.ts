import type {
  ConverseStreamCommandInput,
  ConverseStreamCommandOutput,
  ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  BedrockLang,
  type BedrockConverseClient,
} from "../../src/lang/bedrock/index.ts";
import {
  LangMessage,
  LangMessages,
  toolResult,
} from "../../src/lang/messages.ts";

function events(...items: ConverseStreamOutput[]): AsyncIterable<ConverseStreamOutput> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function completedEvents(): ConverseStreamOutput[] {
  return [
    { messageStart: { role: "assistant" } },
    { messageStop: { stopReason: "end_turn" } },
  ];
}

function mockClient(
  streams: ConverseStreamOutput[][],
): BedrockConverseClient & { inputs: ConverseStreamCommandInput[] } {
  const inputs: ConverseStreamCommandInput[] = [];
  return {
    inputs,
    async send(command): Promise<ConverseStreamCommandOutput> {
      inputs.push(command.input);
      return { stream: events(...(streams.shift() ?? [])) };
    },
  };
}

describe("BedrockLang", () => {
  it("maps a conversation and streams text with Bedrock metadata", async () => {
    const client = mockClient([[
      { messageStart: { role: "assistant" } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: "Hello" },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: " from Bedrock" },
        },
      },
      {
        messageStop: {
          stopReason: "end_turn",
          additionalModelResponseFields: { provider: "test" },
        },
      },
      {
        metadata: {
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
          metrics: { latencyMs: 12 },
        },
      },
    ]]);
    const updates: string[] = [];
    const messages = new LangMessages("Hello");
    messages.instructions = "Conversation instructions";
    const lang = new BedrockLang({
      client,
      model: "test.model-v1",
      systemPrompt: "Provider instructions",
      maxTokens: 512,
      temperature: 0.3,
      topP: 0.8,
      stopSequences: ["STOP"],
    });

    const result = await lang.chat(messages, {
      onResult: message => updates.push(message.text),
      providerSpecificBody: {
        requestMetadata: { project: "aiwrapper" },
      },
    });

    expect(client.inputs).toEqual([{
      modelId: "test.model-v1",
      messages: [{
        role: "user",
        content: [{ text: "Hello" }],
      }],
      system: [{
        text: "Provider instructions\n\nConversation instructions",
      }],
      inferenceConfig: {
        maxTokens: 512,
        temperature: 0.3,
        topP: 0.8,
        stopSequences: ["STOP"],
      },
      requestMetadata: { project: "aiwrapper" },
    }]);
    expect(updates).toEqual(["Hello", "Hello from Bedrock"]);
    expect(result.answer).toBe("Hello from Bedrock");
    expect(result.finished).toBe(true);
    expect(result.at(-1)?.meta).toMatchObject({
      bedrockStopReason: "end_turn",
      bedrockUsage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      bedrockMetrics: { latencyMs: 12 },
      bedrockAdditionalModelResponseFields: { provider: "test" },
    });
  });

  it("streams tool arguments, executes the tool, and sends its result on the next turn", async () => {
    const client = mockClient([
      [
        { messageStart: { role: "assistant" } },
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: {
              toolUse: {
                toolUseId: "call-double",
                name: "double",
              },
            },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: "{\"value\":" } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: "21}" } },
          },
        },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "tool_use" } },
      ],
      [
        { messageStart: { role: "assistant" } },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { text: "The answer is 42." },
          },
        },
        { messageStop: { stopReason: "end_turn" } },
      ],
    ]);
    const handler = vi.fn(({ value }: { value: number }) => value * 2);
    const messages = new LangMessages("Double 21", {
      tools: [{
        name: "double",
        description: "Double a number",
        parameters: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
        },
        handler,
      }],
    });
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    const first = await lang.chat(messages);
    expect(handler).toHaveBeenCalledOnce();
    expect(first.at(-1)?.toolResults).toEqual([{
      type: "tool-result",
      name: "double",
      callId: "call-double",
      result: 42,
    }]);
    expect(client.inputs[0].toolConfig).toEqual({
      tools: [{
        toolSpec: {
          name: "double",
          description: "Double a number",
          inputSchema: {
            json: {
              type: "object",
              properties: { value: { type: "number" } },
              required: ["value"],
            },
          },
        },
      }],
    });

    first.addUserMessage("Summarize.");
    const second = await lang.chat(first);

    expect(handler).toHaveBeenCalledOnce();
    expect(client.inputs[1].messages).toEqual([
      {
        role: "user",
        content: [{ text: "Double 21" }],
      },
      {
        role: "assistant",
        content: [{
          toolUse: {
            toolUseId: "call-double",
            name: "double",
            input: { value: 21 },
          },
        }],
      },
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "call-double",
              content: [{ json: 42 }],
            },
          },
          { text: "Summarize." },
        ],
      },
    ]);
    expect(second.answer).toBe("The answer is 42.");
  });

  it("uses Bedrock native JSON Schema output configuration", async () => {
    const client = mockClient([[
      { messageStart: { role: "assistant" } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: "{\"answer\":\"ok\"}" },
        },
      },
      { messageStop: { stopReason: "end_turn" } },
    ]]);
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    };
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    const result = await lang.askForObject("Return an object", schema);

    expect(client.inputs[0].outputConfig).toEqual({
      textFormat: {
        type: "json_schema",
        structure: {
          jsonSchema: {
            name: "response_schema",
            schema: JSON.stringify(schema),
          },
        },
      },
    });
    expect(result.object).toEqual({ answer: "ok" });
  });

  it("streams reasoning separately from the answer", async () => {
    const client = mockClient([[
      { messageStart: { role: "assistant" } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { reasoningContent: { text: "Check the premise." } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { reasoningContent: { signature: "provider-signature" } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 1,
          delta: { text: "Final answer" },
        },
      },
      { messageStop: { stopReason: "end_turn" } },
    ]]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    const result = await lang.ask("Think first");

    expect(result.at(-1)?.reasoning).toBe("Check the premise.");
    expect(result.answer).toBe("Final answer");
  });

  it("maps user images and multimodal tool results to Bedrock content blocks", async () => {
    const client = mockClient([completedEvents()]);
    const messages = new LangMessages([
      new LangMessage("user", [
        { type: "text", text: "Inspect this" },
        { type: "image", base64: "aGk=", mimeType: "image/jpeg" },
      ]),
      new LangMessage("tool-results", [{
        type: "tool-result",
        name: "camera",
        callId: "camera-1",
        result: toolResult([
          { type: "text", text: "Current frame" },
          { type: "image", base64: "aGk=", mimeType: "image/png" },
        ]),
      }]),
    ]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await lang.chat(messages);

    expect(client.inputs[0].messages).toEqual([
      {
        role: "user",
        content: [
          { text: "Inspect this" },
          {
            image: {
              format: "jpeg",
              source: { bytes: new Uint8Array([104, 105]) },
            },
          },
          {
            toolResult: {
              toolUseId: "camera-1",
              content: [
                { text: "Current frame" },
                {
                  image: {
                    format: "png",
                    source: { bytes: new Uint8Array([104, 105]) },
                  },
                },
              ],
            },
          },
        ],
      },
    ]);
  });

  it("rejects tool results that cannot be serialized as Bedrock JSON", async () => {
    const client = mockClient([completedEvents()]);
    const cyclicResult: Record<string, unknown> = {};
    cyclicResult.self = cyclicResult;
    const messages = new LangMessages([
      new LangMessage("tool-results", [{
        type: "tool-result",
        name: "cyclic",
        callId: "call-cyclic",
        result: cyclicResult,
      }]),
    ]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.chat(messages)).rejects.toThrow(
      "Bedrock tool results must be JSON-serializable",
    );
    expect(client.inputs).toHaveLength(0);
  });

  it("rejects remote image URLs because Converse requires bytes or S3 locations", async () => {
    const client = mockClient([completedEvents()]);
    const messages = new LangMessages();
    messages.addUserItems([{
      type: "image",
      url: "https://example.com/image.png",
    }]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.chat(messages)).rejects.toThrow(
      "Bedrock Converse does not accept remote image URLs",
    );
    expect(client.inputs).toHaveLength(0);
  });

  it("accepts the provider-neutral plain message shape", async () => {
    const client = mockClient([completedEvents()]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await lang.chat([{
      role: "user",
      items: [{ type: "text", text: "Hello" }],
    }]);

    expect(client.inputs[0].messages).toEqual([{
      role: "user",
      content: [{ text: "Hello" }],
    }]);
  });

  it("rejects provider-specific headers instead of silently ignoring them", async () => {
    const client = mockClient([completedEvents()]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.ask("Hello", {
      providerSpecificHeaders: { "x-test": "ignored" },
    })).rejects.toThrow(
      "BedrockLang does not support providerSpecificHeaders",
    );
    expect(client.inputs).toHaveLength(0);
  });

  it("rejects message items that Bedrock cannot represent in their role", async () => {
    const client = mockClient([completedEvents()]);
    const messages = new LangMessages([
      new LangMessage("user", [{
        type: "tool",
        name: "lookup",
        callId: "call-1",
        arguments: {},
      }]),
    ]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.chat(messages)).rejects.toThrow(
      'cannot represent a "tool" item in a "user" message',
    );
    expect(client.inputs).toHaveLength(0);
  });

  it("rejects streams that end before Bedrock sends messageStop", async () => {
    const client = mockClient([[
      { messageStart: { role: "assistant" } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: "Truncated" },
        },
      },
    ]]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.ask("Hello")).rejects.toThrow(
      "ended before messageStop",
    );
  });

  it("rejects malformed tool starts instead of inventing call identifiers", async () => {
    const client = mockClient([[
      { messageStart: { role: "assistant" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: {
              toolUseId: undefined,
              name: "lookup",
            },
          },
        },
      },
    ]]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.ask("Hello")).rejects.toThrow(
      "tool use without a toolUseId",
    );
  });

  it("fails explicitly on streamed image output it cannot represent", async () => {
    const client = mockClient([[
      { messageStart: { role: "assistant" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { image: { format: "png" } },
        },
      },
    ]]);
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.ask("Draw something")).rejects.toThrow(
      "streamed image output is not supported",
    );
  });

  it("rejects invalid streamed tool arguments before executing a handler", async () => {
    const handler = vi.fn();
    const client = mockClient([[
      { messageStart: { role: "assistant" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: {
              toolUseId: "call-lookup",
              name: "lookup",
            },
          },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: "{\"broken\":" } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
    ]]);
    const messages = new LangMessages("Look this up", {
      tools: [{
        name: "lookup",
        description: "Look something up",
        parameters: { type: "object" },
        handler,
      }],
    });
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    await expect(lang.chat(messages)).rejects.toThrow(
      'invalid JSON arguments for tool "lookup"',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("marks aborted conversations and attaches the partial result", async () => {
    const client: BedrockConverseClient = {
      async send() {
        return {
          stream: {
            async *[Symbol.asyncIterator]() {
              yield {
                messageStart: { role: "assistant" },
              } satisfies ConverseStreamOutput;
              yield {
                contentBlockDelta: {
                  contentBlockIndex: 0,
                  delta: { text: "Partial" },
                },
              } satisfies ConverseStreamOutput;
              throw new DOMException("Aborted", "AbortError");
            },
          },
        };
      },
    };
    const lang = new BedrockLang({ client, model: "test.model-v1" });

    try {
      await lang.ask("Start");
      throw new Error("Expected request to abort");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AbortError",
        partialResult: {
          aborted: true,
          finished: false,
        },
      });
      expect((error as { partialResult: LangMessages }).partialResult.answer).toBe("Partial");
    }
  });
});
