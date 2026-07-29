import { afterEach, describe, expect, it } from "vitest";
import { AnthropicLang } from "../../src/lang/anthropic/anthropic-lang.ts";
import { CohereLang } from "../../src/lang/cohere/cohere-lang.ts";
import { DeepSeekLang } from "../../src/lang/deepseek/deepseek-lang.ts";
import { GoogleLang } from "../../src/lang/google/google-lang.ts";
import { LangResult } from "../../src/lang/language-provider.ts";
import { LangMessages } from "../../src/lang/messages.ts";
import { OllamaLang } from "../../src/lang/ollama/ollama-lang.ts";
import { OpenAIChatCompletionsLang } from "../../src/lang/openai/openai-chat-completions-lang.ts";
import { OpenAILang } from "../../src/lang/openai/openai-lang.ts";
import { setHttpRequestImpl } from "../../src/http-request.ts";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  setHttpRequestImpl((url, options) => nativeFetch(url, options as RequestInit));
});

describe("provider streaming", () => {
  it("sends OpenAI Responses constructor and conversation instructions once", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const messages = new LangMessages("Hello");
    messages.instructions = "Conversation instructions";
    const lang = new OpenAILang({
      apiKey: "test",
      systemPrompt: "Constructor instructions",
    });

    await lang.chat(messages);

    expect(requestBody.instructions).toBe(
      "Constructor instructions\n\nConversation instructions",
    );
  });

  it("sends raw JSON Schema in the OpenAI Responses text format", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response([
        "event: response.created",
        'data: {"response":{"id":"resp_schema"}}',
        "event: response.output_item.added",
        'data: {"item":{"id":"msg_schema","type":"message","text":""}}',
        "event: response.output_text.delta",
        'data: {"item_id":"msg_schema","delta":"{\\"answer\\":\\"ok\\"}"}',
        "event: response.output_item.done",
        'data: {"item":{"id":"msg_schema","type":"message","content":[{"type":"output_text","text":"{\\"answer\\":\\"ok\\"}"}]}}',
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
      additionalProperties: false,
    };
    const lang = new OpenAILang({ apiKey: "test" });

    const result = await lang.ask("Return an object", { schema });

    expect(requestBody.text).toEqual({
      format: {
        type: "json_schema",
        name: "response_schema",
        strict: true,
        schema,
      },
    });
    expect(requestBody).not.toHaveProperty("json_schema");
    expect(result.object).toEqual({ answer: "ok" });
    expect(result.finished).toBe(true);
  });

  it("sends a Chat Completions system prompt as one system message", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const messages = new LangMessages("Hello");
    messages.instructions = "Conversation instructions";
    const lang = OpenAIChatCompletionsLang.custom({
      model: "custom-model",
      baseURL: "https://example.com/v1",
      systemPrompt: "Constructor instructions",
    });

    await lang.chat(messages);

    expect(requestBody.messages).toEqual([
      {
        role: "system",
        content: "Constructor instructions\n\nConversation instructions",
      },
      { role: "user", content: "Hello" },
    ]);
  });

  it("builds Chat Completions schema instructions without mutating the conversation", async () => {
    const requestBodies: any[] = [];
    setHttpRequestImpl(async (_url, options) => {
      requestBodies.push(JSON.parse(String(options.body)));
      return new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const lang = OpenAIChatCompletionsLang.custom({
      model: "custom-model",
      baseURL: "https://example.com/v1",
    });
    const messages = new LangMessages("Return an object");

    const options = { schema: { type: "object", properties: {} } };
    await lang.chat(messages, options);
    await lang.chat(messages, options);

    const systemMessage = requestBodies[1].messages.find(
      (message: any) => message.role === "system",
    );
    expect(systemMessage.content).not.toContain("undefined");
    expect(systemMessage.content.match(/<outputFormat>/g)).toHaveLength(1);
    expect(messages.instructions).toBeUndefined();
  });

  it("does not mutate Chat Completions token configuration during a request", async () => {
    class TestReasoningLang extends OpenAIChatCompletionsLang {
      override supportsReasoning(): boolean {
        return true;
      }
    }

    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const lang = new TestReasoningLang({
      model: "reasoning-model",
      baseURL: "https://example.com/v1",
      systemPrompt: "",
      maxTokens: 1000,
    });

    await lang.ask("Think");

    expect(requestBody.max_completion_tokens).toBe(25000);
    expect(lang.getMaxCompletionTokens()).toBeUndefined();
  });

  it("composes Google instructions without mutating the conversation", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const messages = new LangMessages("Hello");
    messages.instructions = "Conversation instructions";
    const lang = new GoogleLang({
      apiKey: "test",
      model: "gemini-2.5-pro",
      systemPrompt: "Constructor instructions",
    });

    await lang.chat(messages, {
      schema: { type: "object", properties: {} },
    });

    const instructions = requestBody.system_instruction.parts[0].text;
    expect(instructions).toContain(
      "Constructor instructions\n\nConversation instructions",
    );
    expect(instructions.match(/<outputFormat>/g)).toHaveLength(1);
    expect(messages.instructions).toBe("Conversation instructions");
  });

  it("composes Anthropic constructor and conversation instructions", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const messages = new LangMessages("Hello");
    messages.instructions = "Conversation instructions";
    const lang = new AnthropicLang({
      apiKey: "test",
      model: "claude-sonnet-4-6",
      systemPrompt: "Constructor instructions",
    });

    await lang.chat(messages);

    expect(requestBody.system).toBe(
      "Constructor instructions\n\nConversation instructions",
    );
  });

  it("accumulates Cohere content deltas", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options) => {
      requestBody = JSON.parse(String(options.body));
      return new Response([
        'event: message-start',
        'data: {"type":"message-start","delta":{"message":{"role":"assistant"}}}',
        'event: content-delta',
        'data: {"type":"content-delta","delta":{"message":{"content":{"text":"Hello"}}}}',
        'event: content-delta',
        'data: {"type":"content-delta","delta":{"message":{"content":{"text":" world"}}}}',
        'event: message-end',
        'data: {"type":"message-end","delta":{"finish_reason":"COMPLETE"}}',
        '',
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const streamed: string[] = [];
    const messages = new LangMessages("Say hello");
    messages.instructions = "Conversation instructions";
    const lang = new CohereLang({
      apiKey: "test",
      model: "command-r-plus-08-2024",
      systemPrompt: "Constructor instructions",
    });
    const result = await lang.chat(messages, {
      onResult: message => streamed.push(message.text),
    });

    expect(requestBody.preamble_override).toBe(
      "Constructor instructions\n\nConversation instructions",
    );
    expect(result.answer).toBe("Hello world");
    expect(result.finished).toBe(true);
    expect(streamed).toContain("Hello");
    expect(streamed[streamed.length - 1]).toBe("Hello world");
  });

  it("preserves partial Cohere messages when a stream is aborted", async () => {
    setHttpRequestImpl(async () => new Response(
      new ReadableStream<Uint8Array>({}),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    ));

    const controller = new AbortController();
    const lang = new CohereLang({ apiKey: "test", model: "command-r-plus-08-2024" });
    const pending = lang.ask("Wait", { signal: controller.signal });
    controller.abort();

    const error = await pending.catch(caught => caught);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(error.partialResult).toBeInstanceOf(LangMessages);
    expect(error.partialResult.aborted).toBe(true);
  });

  it("serializes and accumulates Ollama chat streams", async () => {
    let requestBody: any;
    setHttpRequestImpl(async (_url, options: any) => {
      requestBody = JSON.parse(options.body);
      return new Response([
        '{"message":{"role":"assistant","thinking":"Checking"},"done":false}',
        '{"message":{"role":"assistant","content":"Hello"},"done":false}',
        '{"message":{"role":"assistant","content":" world"},"done":true}',
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    });

    const messages = new LangMessages();
    messages.instructions = "Be concise.";
    messages.addUserItems([
      { type: "text", text: "Describe this." },
      { type: "image", base64: "aGVsbG8=", mimeType: "image/png" },
    ]);
    messages.availableTools = [{
      name: "double",
      description: "Double a number",
      parameters: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      },
      handler: ({ value }) => value * 2,
    }];

    const streamed: string[] = [];
    const lang = new OllamaLang({
      model: "local-test-model",
      maxTokens: 50,
      systemPrompt: "Base behavior.",
    });
    const result = await lang.chat(messages, {
      onResult: message => streamed.push(message.text),
    });

    expect(result.answer).toBe("Hello world");
    expect(result[result.length - 1].reasoning).toBe("Checking");
    expect(result.finished).toBe(true);
    expect(result.availableTools).toBe(messages.availableTools);
    expect(streamed[streamed.length - 1]).toBe("Hello world");

    expect(requestBody.messages).toEqual([
      { role: "system", content: "Base behavior.\n\nBe concise." },
      {
        role: "user",
        content: "Describe this.",
        images: ["aGVsbG8="],
      },
    ]);
    expect(requestBody.options).toEqual({ num_predict: 50 });
    expect(requestBody.tools[0].function.name).toBe("double");
  });

  it("executes Ollama tool calls", async () => {
    setHttpRequestImpl(async () => new Response(
      '{"message":{"role":"assistant","tool_calls":[{"function":{"name":"double","arguments":{"value":21}}}]},"done":true}',
      {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      },
    ));

    const messages = new LangMessages("Double 21");
    messages.availableTools = [{
      name: "double",
      description: "Double a number",
      parameters: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      },
      handler: ({ value }) => value * 2,
    }];

    const result = await new OllamaLang({ model: "local-test-model" }).chat(messages);

    expect(result[result.length - 2].toolRequests).toEqual([
      {
        type: "tool",
        callId: "ollama_tool_0",
        name: "double",
        arguments: { value: 21 },
      },
    ]);
    expect(result[result.length - 1].toolResults[0].result).toBe(42);
  });

  it("uses the shared OpenAI-compatible reasoning handler for DeepSeek", () => {
    class TestDeepSeekLang extends DeepSeekLang {
      feed(data: any, messages: LangMessages): void {
        this.handleStreamData(data, messages);
      }
    }

    const lang = new TestDeepSeekLang({ apiKey: "test", model: "deepseek-reasoner" });
    const messages = new LangMessages("Think briefly");

    lang.feed({ choices: [{ delta: { reasoning_content: "Reasoning" } }] }, messages);
    lang.feed({ choices: [{ delta: { content: "Answer" } }] }, messages);
    lang.feed({ finished: true }, messages);

    const response = messages[messages.length - 1];
    expect(response.reasoning).toBe("Reasoning");
    expect(response.text).toBe("Answer");
    expect(messages.finished).toBe(true);
  });
});

describe("LangResult metadata", () => {
  it("preserves conversation options when a provider wraps messages", () => {
    const source = new LangMessages("Hello", {
      tools: [{ name: "web_search" }],
    });
    source.instructions = "Be concise.";
    source.aborted = true;

    const result = new LangResult(source);

    expect(result.availableTools).toBe(source.availableTools);
    expect(result.instructions).toBe("Be concise.");
    expect(result.aborted).toBe(true);
  });
});
