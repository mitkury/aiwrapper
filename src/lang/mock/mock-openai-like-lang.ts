import { 
  LangMessage,
  LangOptions,
  LanguageProvider
} from "../language-provider.ts";
import { LangMessages } from "../messages.ts";
import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";

export type MockOpenAILikeOptions = {
  model?: string;
  systemPrompt?: string;
  mockResponseText?: string | (() => string);
  mockResponseObject?: any;
  stream?: boolean;
  chunkSize?: number;
  // Simulate tool_calls streaming with partial JSON arguments
  mockToolCalls?: Array<{
    id?: string;
    name: string;
    argumentsChunks: string[];
  }>;
};

/**
 * Mock provider that behaves like an OpenAI-compatible API without network calls.
 * It emits streaming deltas shaped as OpenAI chat completions SSE payloads.
 */
export class MockOpenAILikeLang extends OpenAIChatCompletionsLang {
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
  ): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage(prompt);
    return this.chat(messages, options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    // Normalize to LangMessages
    const messageCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    const result = messageCollection;
    const onResult = options?.onResult;
    const toolArgBuffers = new Map<string, { name: string; buffer: string }>();

    // If mockToolCalls provided, emit tool_calls deltas instead of plain content
    if (this.mockConfig.mockToolCalls && this.mockConfig.mockToolCalls.length > 0) {
      let index = 0;
      for (const call of this.mockConfig.mockToolCalls) {
        const id = call.id || `call_${index++}`;
        // Emit name first chunk (OpenAI may send name separately)
        const nameDelta = { choices: [{ delta: { tool_calls: [{ id, function: { name: call.name } }] } }] } as any;
        (this as any).handleStreamData(nameDelta, result, messageCollection, onResult, toolArgBuffers);
        // Emit argument chunks
        for (const chunk of call.argumentsChunks) {
          const delta = { choices: [{ delta: { tool_calls: [{ id, function: { arguments: chunk } }] } }] } as any;
          (this as any).handleStreamData(delta, result, messageCollection, onResult, toolArgBuffers);
        }
      }
      // Finished
      (this as any).handleStreamData({ finished: true }, result, messageCollection, onResult, toolArgBuffers);
      // Consume mockToolCalls so subsequent chats produce a normal answer
      this.mockConfig.mockToolCalls = [];
      return result;
    }

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
      (this as any).handleStreamData(deltaPayload, result, messageCollection, onResult, toolArgBuffers);
    }

    // Emit finished signal similar to SSE end
    (this as any).handleStreamData({ finished: true }, result, messageCollection, onResult, toolArgBuffers);

    return result;
  }
}