import { describe, expect, it } from "vitest";
import { AnthropicLang } from "../../src/lang/anthropic/anthropic-lang.ts";
import { GoogleLang } from "../../src/lang/google/google-lang.ts";
import { LangMessage, LangMessages, toolResult } from "../../src/lang/messages.ts";
import { OllamaLang } from "../../src/lang/ollama/ollama-lang.ts";
import { OpenAIChatCompletionsLang } from "../../src/lang/openai/openai-chat-completions-lang.ts";

class TestAnthropicLang extends AnthropicLang {
  transform(messages: LangMessages): any[] {
    return this.transformMessagesForProvider(messages);
  }
}

class TestGoogleLang extends GoogleLang {
  transform(messages: LangMessages): any[] {
    return this.transformMessagesForProvider(messages);
  }
}

class TestOpenAIChatCompletionsLang extends OpenAIChatCompletionsLang {
  transform(messages: LangMessages): any[] {
    return this.transformMessagesForProvider(messages);
  }
}

function cameraToolResults(): LangMessages {
  return new LangMessages([
    new LangMessage("tool-results", [{
      type: "tool-result",
      name: "capture_camera",
      callId: "call-camera",
      result: toolResult([
        { type: "text", text: "Current camera frame" },
        { type: "image", base64: "aGk=", mimeType: "image/jpeg" },
      ]),
    }]),
  ]);
}

describe("multimodal tool result provider mapping", () => {
  it("maps user images without injecting extra prompt text", () => {
    const messages = new LangMessages();
    messages.addUserItems([
      { type: "text", text: "What is shown?" },
      { type: "image", base64: "aGk=", mimeType: "image/jpeg" },
    ]);

    const anthropic = new TestAnthropicLang({
      apiKey: "test",
      model: "claude-sonnet-4-6",
    });
    expect(anthropic.transform(messages)).toEqual([{
      role: "user",
      content: [
        { type: "text", text: "What is shown?" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "aGk=",
          },
        },
      ],
    }]);

    const chatCompletions = new TestOpenAIChatCompletionsLang({
      model: "custom-model",
      baseURL: "https://example.com/v1",
      systemPrompt: "",
    });
    expect(chatCompletions.transform(messages)).toEqual([{
      role: "user",
      content: [
        { type: "text", text: "What is shown?" },
        {
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64,aGk=",
          },
        },
      ],
    }]);
  });

  it("maps image parts into Anthropic tool_result content", () => {
    const lang = new TestAnthropicLang({
      apiKey: "test",
      model: "claude-sonnet-4-6",
    });

    expect(lang.transform(cameraToolResults())).toEqual([{
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "call-camera",
        content: [
          { type: "text", text: "Current camera frame" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "aGk=",
            },
          },
        ],
      }],
    }]);
  });

  it("maps image parts into Gemini 3 functionResponse parts", () => {
    const lang = new TestGoogleLang({
      apiKey: "test",
      model: "gemini-3.5-flash",
    });

    expect(lang.transform(cameraToolResults())).toEqual([{
      role: "user",
      parts: [{
        functionResponse: {
          id: "call-camera",
          name: "capture_camera",
          response: {
            output: [
              "Current camera frame",
              { $ref: "tool-result-1.jpg" },
            ],
          },
          parts: [{
            inlineData: {
              displayName: "tool-result-1.jpg",
              mimeType: "image/jpeg",
              data: "aGk=",
            },
          }],
        },
      }],
    }]);
  });

  it("rejects image function responses for Gemini 2 models", () => {
    const lang = new TestGoogleLang({
      apiKey: "test",
      model: "gemini-2.5-pro",
    });

    expect(() => lang.transform(cameraToolResults())).toThrow(
      "Use a Gemini 3-series model",
    );
  });

  it("rejects images in text-only Chat Completions tool messages", () => {
    const lang = new TestOpenAIChatCompletionsLang({
      model: "custom-model",
      baseURL: "https://example.com/v1",
      systemPrompt: "",
    });

    expect(() => lang.transform(cameraToolResults())).toThrow(
      "Chat Completions-compatible APIs do not have a portable image format for tool messages",
    );
  });

  it("rejects images in text-only Ollama tool messages", async () => {
    const lang = new OllamaLang({ model: "local-test-model" });

    await expect(lang.chat(cameraToolResults())).rejects.toThrow(
      "Ollama does not support image content in tool result messages",
    );
  });

  it("allows explicit text content in Chat Completions tool messages", () => {
    const lang = new TestOpenAIChatCompletionsLang({
      model: "custom-model",
      baseURL: "https://example.com/v1",
      systemPrompt: "",
    });
    const messages = new LangMessages([
      new LangMessage("tool-results", [{
        type: "tool-result",
        name: "status",
        callId: "call-status",
        result: toolResult({ type: "text", text: "ready" }),
      }]),
    ]);

    expect(lang.transform(messages)).toEqual([{
      role: "tool",
      tool_call_id: "call-status",
      name: "status",
      content: [{ type: "text", text: "ready" }],
    }]);
  });
});
