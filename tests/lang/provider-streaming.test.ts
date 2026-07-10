import { afterEach, describe, expect, it } from "vitest";
import { CohereLang } from "../../src/lang/cohere/cohere-lang.ts";
import { DeepSeekLang } from "../../src/lang/deepseek/deepseek-lang.ts";
import { LangResult } from "../../src/lang/language-provider.ts";
import { LangMessages } from "../../src/lang/messages.ts";
import { OllamaLang } from "../../src/lang/ollama/ollama-lang.ts";
import { setHttpRequestImpl } from "../../src/http-request.ts";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  setHttpRequestImpl((url, options) => nativeFetch(url, options as RequestInit));
});

describe("provider streaming", () => {
  it("accumulates Cohere content deltas", async () => {
    setHttpRequestImpl(async () => new Response([
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
    }));

    const streamed: string[] = [];
    const lang = new CohereLang({ apiKey: "test", model: "command-r-plus-08-2024" });
    const result = await lang.ask("Say hello", {
      onResult: message => streamed.push(message.text),
    });

    expect(result.answer).toBe("Hello world");
    expect(result.finished).toBe(true);
    expect(streamed).toContain("Hello");
    expect(streamed[streamed.length - 1]).toBe("Hello world");
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
    const lang = new OllamaLang({ model: "local-test-model", maxTokens: 50 });
    const result = await lang.chat(messages, {
      onResult: message => streamed.push(message.text),
    });

    expect(result.answer).toBe("Hello world");
    expect(result[result.length - 1].reasoning).toBe("Checking");
    expect(result.finished).toBe(true);
    expect(result.availableTools).toBe(messages.availableTools);
    expect(streamed[streamed.length - 1]).toBe("Hello world");

    expect(requestBody.messages).toEqual([
      { role: "system", content: "Be concise." },
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
