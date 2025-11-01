import { Agent } from "./agent";
import { LangMessage, LangMessages, LanguageProvider, ToolWithHandler } from "../lang/index.ts";
import { LangMessageContent, LangMessageRole, LangTool } from "../lang/messages";

export type ChatOutput = {
  answer: string;
  messages: LangMessage[];
};

export interface ChatStreamingEvent {
  type: "streaming";
  data: { msg: LangMessage; idx: number };
}

export class ChatAgent extends Agent<{ role: LangMessageRole; content: LangMessageContent }[] | LangMessages | LangMessage[], LangMessages, ChatStreamingEvent> {
  private lang?: LanguageProvider;
  private messages: LangMessages;

  constructor(lang?: LanguageProvider, options?: { tools?: LangTool[] }) {
    super();
    this.lang = lang;

    this.messages = new LangMessages([], {
      tools: options?.tools,
    });
  }

  protected async runInternal(input: { role: LangMessageRole; content: LangMessageContent }[] | LangMessages | LangMessage[]): Promise<LangMessages> {
    if (input instanceof LangMessages) {
      this.messages = input;
    }
    else {
      this.messages.push(...new LangMessages(input));
    }

    if (!this.lang) {
      throw new Error("Language provider not set");
    }

    // Agentic loop. Will go in multiple cicles if it is using tools.
    let streamIdx = 0;
    while (true) {
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
        }
      });

      this.messages = response;

      // We continue the loop if the last message is a tool usage results.
      const lastMessage = this.messages[this.messages.length - 1];
      const lastMessageHasToolResults = lastMessage && lastMessage.role === 'tool-results';
      if (!lastMessageHasToolResults) {
        break;
      }

      // Increment index for the next iteration since we'll be starting with new messages
      streamIdx++;
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
}