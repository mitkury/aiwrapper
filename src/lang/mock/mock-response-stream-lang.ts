import { 
  LangOptions, 
  LanguageProvider 
} from "../language-provider.ts";
import { 
  LangMessage, 
  LangMessageItem,
  LangMessageRole, 
  LangMessages 
} from "../messages.ts";
import { OpenAIResponseStreamHandler } from "../openai/responses/openai-responses-stream-handler.ts";

type MessageFactory = string | (() => string);

export type MockResponseStreamOptions = {
  /**
   * Deterministic message to emit every time. Overrides `messages` rotation.
   */
  message?: MessageFactory;
  /**
   * Pool of pre-written answers that the mock will rotate through.
   */
  messages?: string[];
  /**
   * Characters per streamed chunk.
   */
  chunkSize?: number;
  /**
   * Delay in milliseconds between chunks.
   */
  speedMs?: number;
  /**
   * Optional custom provider name for debugging.
   */
  name?: string;
};

type MockResponseStreamOverrides = {
  message?: MessageFactory;
  messages?: string[];
  chunkSize?: number;
  speedMs?: number;
};

const DEFAULT_MESSAGES = [
  "Mini reply: hi there!",
  "Small mock message incoming.",
  "Little response from the mock provider."
];

const randomId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sleep = (ms?: number): Promise<void> =>
  !ms || ms <= 0
    ? Promise.resolve()
    : new Promise(resolve => setTimeout(resolve, ms));

const isOverrides = (value: unknown): value is MockResponseStreamOverrides =>
  !!value && typeof value === "object";

export class MockResponseStreamLang extends LanguageProvider {
  private readonly config: MockResponseStreamOptions;
  private presetIndex = 0;

  constructor(options: MockResponseStreamOptions = {}) {
    super(options.name ?? "Mock Response Stream");
    this.config = options;
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage(prompt);
    return this.chat(messages, options);
  }

  async chat(
    messages: { role: LangMessageRole; items: LangMessageItem[]; }[] | LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    await this.streamMockResponse(messageCollection, options);
    return messageCollection;
  }

  private resolveOverrides(options?: LangOptions): MockResponseStreamOverrides {
    const providerBody = options?.providerSpecificBody;
    if (providerBody && typeof providerBody === "object" && providerBody !== null) {
      const overrides = (providerBody as Record<string, unknown>).mockResponseStream;
      if (isOverrides(overrides)) {
        return overrides;
      }
    }
    return {};
  }

  private pickMessage(overrides: MockResponseStreamOverrides): string {
    const messageSource = overrides.message ?? this.config.message;
    if (typeof messageSource === "function") {
      return messageSource();
    }
    if (typeof messageSource === "string" && messageSource.length > 0) {
      return messageSource;
    }

    const presetList = this.resolveMessageList(overrides);
    if (presetList.length === 0) {
      return "Mock response";
    }

    const idx = this.presetIndex % presetList.length;
    const selected = presetList[idx];
    this.presetIndex = (this.presetIndex + 1) % presetList.length;
    return selected;
  }

  private resolveMessageList(overrides: MockResponseStreamOverrides): string[] {
    if (overrides.messages && overrides.messages.length > 0) {
      return overrides.messages;
    }
    if (this.config.messages && this.config.messages.length > 0) {
      return this.config.messages;
    }
    return DEFAULT_MESSAGES;
  }

  private resolveChunkSize(overrides: MockResponseStreamOverrides): number {
    const size = overrides.chunkSize ?? this.config.chunkSize ?? 12;
    return size > 0 ? size : 12;
  }

  private resolveSpeed(overrides: MockResponseStreamOverrides): number {
    return overrides.speedMs ?? this.config.speedMs ?? 0;
  }

  private chunkText(text: string, chunkSize: number): string[] {
    if (chunkSize <= 0 || text.length === 0) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks.length > 0 ? chunks : [text];
  }

  private async streamMockResponse(messages: LangMessages, options?: LangOptions): Promise<void> {
    const overrides = this.resolveOverrides(options);
    const responseText = this.pickMessage(overrides);
    const chunkSize = this.resolveChunkSize(overrides);
    const delay = this.resolveSpeed(overrides);

    const handler = new OpenAIResponseStreamHandler(messages, options?.onResult);
    const responseId = randomId("resp_mock");
    const itemId = randomId("msg_mock");

    handler.handleEvent({
      type: "response.created",
      response: { id: responseId }
    });

    handler.handleEvent({
      type: "response.output_item.added",
      item: {
        id: itemId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
        text: ""
      }
    });

    const chunks = this.chunkText(responseText, chunkSize);
    for (const chunk of chunks) {
      await sleep(delay);
      if (chunk.length > 0) {
        handler.handleEvent({
          type: "response.output_text.delta",
          item_id: itemId,
          delta: chunk
        });
      }
    }

    handler.handleEvent({
      type: "response.output_item.done",
      item: {
        id: itemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: responseText,
            annotations: [],
            logprobs: []
          }
        ]
      }
    });

    handler.handleEvent({
      type: "response.completed",
      response: {
        id: responseId,
        status: "completed"
      }
    });

    messages.finished = true;
  }
}
