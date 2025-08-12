import { 
  LangChatMessageCollection,
  LangChatMessage,
  LangOptions,
  LangResult,
  LanguageProvider
} from "../language-provider.ts";
import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";

export type MockOpenAILikeOptions = {
  model?: string;
  systemPrompt?: string;
  mockResponseText?: string | (() => string);
  mockResponseObject?: any;
  stream?: boolean;
  chunkSize?: number;
};

/**
 * Mock provider that behaves like an OpenAI-compatible API without network calls.
 * It emits streaming deltas shaped as OpenAI chat completions SSE payloads.
 */
export class MockOpenAILikeLang extends OpenAILikeLang {
  private readonly mockConfig: MockOpenAILikeOptions;

  constructor(options: MockOpenAILikeOptions = {}) {
    super({
      apiKey: "", // not used
      model: options.model || "gpt-4o-mini",
      systemPrompt: options.systemPrompt || "",
      baseURL: "http://mock.local" // not used
    });
    this.mockConfig = options;
  }

  async ask(
    prompt: string,
    options?: LangOptions,
  ): Promise<LangResult> {
    const messages = new LangChatMessageCollection();
    messages.addUserMessage(prompt);
    return this.chat(messages, options);
  }

  async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult> {
    // Normalize messages to collection
    const messageCollection = messages instanceof LangChatMessageCollection
      ? messages
      : new LangChatMessageCollection(...messages);

    const result = new LangResult(messageCollection);
    const onResult = options?.onResult;

    // Decide content to emit
    let fullContent = "Hello from MockOpenAI";
    if (options?.schema && this.mockConfig.mockResponseObject !== undefined) {
      fullContent = JSON.stringify(this.mockConfig.mockResponseObject);
    } else if (typeof this.mockConfig.mockResponseText === 'function') {
      fullContent = this.mockConfig.mockResponseText();
    } else if (typeof this.mockConfig.mockResponseText === 'string') {
      fullContent = this.mockConfig.mockResponseText;
    }

    // Simulate streaming by splitting into chunks
    const chunkSize = this.mockConfig.chunkSize || 16;
    const chunks: string[] = [];
    for (let i = 0; i < fullContent.length; i += chunkSize) {
      chunks.push(fullContent.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
      const deltaPayload = {
        choices: [
          { delta: { content: chunk } }
        ]
      } as any;
      // Use parent handler to process deltas
      (this as any).handleStreamData(deltaPayload, result, messageCollection, onResult);
    }

    // Emit finished signal similar to SSE end
    (this as any).handleStreamData({ finished: true }, result, messageCollection, onResult);

    return result;
  }
}