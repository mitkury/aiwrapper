import { Agent } from "./agent";
import { LangMessage, LangMessages, LanguageProvider, ToolWithHandler } from "../lang/index.ts";
import { LangTool } from "../lang/messages";

export type ChatOutput = {
  answer: string;
  messages: LangMessage[];
};

export interface ChatStreamingEvent {
  type: "streaming";
  data: LangMessages;
}

export class ChatAgent extends Agent<LangMessages | LangMessage[], LangMessages, ChatStreamingEvent> {
  private lang?: LanguageProvider;
  private messages: LangMessages;

  constructor(lang?: LanguageProvider, options?: { tools?: LangTool[] }) {
    super();
    this.lang = lang;

    this.messages = new LangMessages([], {
      tools: options?.tools,
    });
  }

  protected async runInternal(input: LangMessages | LangMessage[]): Promise<LangMessages> {
    if (input instanceof LangMessages) {
      this.messages = input;
    }
    else {
      for (const message of input) {
        this.messages.push(message);
      }
    }

    if (!this.lang) {
      throw new Error("Language provider not set");
    }

    // Agentic loop. Will go in multiple cicles if it is using tools.
    while (true) {
      const response = await this.lang.chat(this.messages, {
        onResult: (result) => {
          this.emit({ type: "streaming", data: result });
        }
      });

      this.messages = response;

      // We continue the loop if the last message is a tool usage results.
      const lastMessage = this.messages[this.messages.length - 1];
      const lastMessageHasToolResults = lastMessage && lastMessage.role === 'tool-results';
      if (!lastMessageHasToolResults) {
        break;
      }
    }

    this.emit({ type: "finished", output: this.messages });

    return this.messages;
  }

  getMessages(): LangMessages {
    return this.messages;
  }

  setLanguageProvider(lang: LanguageProvider): void {
    this.lang = lang;
  }

  setTools(tools: ToolWithHandler[]): void {
    this.messages.availableTools = tools;
  }
}