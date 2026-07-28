import { Agent } from "./agent.js";
import { LangMessage, LangMessages, LanguageProvider } from "../lang/index.js";
import type { LangMessageItem, LangMessageRole, LangTool } from "../lang/messages.js";

export interface ChatStreamingEvent {
  type: "streaming";
  data: { msg: LangMessage; idx: number };
}

export type ChatAgentInput =
  | { role: LangMessageRole; items: LangMessageItem[] }[]
  | LangMessages
  | LangMessage[];

export interface ChatAgentOptions {
  tools?: LangTool[];
  /** Maximum number of model turns allowed in one run. */
  maxIterations?: number;
}

export class ChatAgent
  extends Agent<
    ChatAgentInput,
    LangMessages,
    ChatStreamingEvent
  > {
  static readonly defaultMaxIterations = 8;

  private lang?: LanguageProvider;
  private readonly maxIterations: number;
  private readonly configuredTools?: LangTool[];
  messages: LangMessages;

  constructor(lang?: LanguageProvider, options: ChatAgentOptions = {}) {
    super();
    this.lang = lang;
    this.configuredTools = options.tools;
    this.maxIterations = options.maxIterations
      ?? ChatAgent.defaultMaxIterations;

    if (!Number.isInteger(this.maxIterations) || this.maxIterations < 1) {
      throw new RangeError("ChatAgent maxIterations must be a positive integer");
    }

    this.messages = new LangMessages([], {
      tools: options.tools,
    });
  }

  protected async runInternal(
    input?: ChatAgentInput,
    options?: { signal?: AbortSignal },
  ): Promise<LangMessages> {
    if (!this.lang) {
      throw new Error("Language provider not set");
    }

    if (input instanceof LangMessages) {
      this.messages = input;
      this.messages.availableTools ??= this.configuredTools;
    } else if (input) {
      this.messages.push(...new LangMessages(input));
    }

    // Agentic loop. It continues while tool results need another model turn.
    let streamIdx = 0;
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      let lastRoleInRun: string | null = null;
      const response = await this.lang.chat(this.messages, {
        onResult: (msg) => {
          // This is how we detect if we're dealing with a new message.
          if (msg.role != lastRoleInRun) {
            if (lastRoleInRun !== null) {
              streamIdx++;
            }
            lastRoleInRun = msg.role;
          }
          this.emit({ type: "streaming", data: { msg, idx: streamIdx } });
        },
        signal: options?.signal,
      });

      this.messages = response;

      // We continue the loop if the last message has tool results.
      // If it has - it means we need to give them to the model.
      const lastMessage = this.messages[this.messages.length - 1];
      const lastMessageHasToolResults = lastMessage &&
        lastMessage.toolResults.length > 0;
      if (!lastMessageHasToolResults) {
        this.emit({ type: "finished", output: this.messages });
        return this.messages;
      }

      // Increment index for the next iteration since we'll be starting with new messages
      streamIdx++;
    }

    throw new Error(
      `ChatAgent reached its ${this.maxIterations}-iteration limit before producing a final response`,
    );
  }

  getMessages(): LangMessages {
    return this.messages;
  }

  setLanguageProvider(lang: LanguageProvider): void {
    this.lang = lang;
  }
}
