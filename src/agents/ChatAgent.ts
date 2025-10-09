import { Agent } from "./agent.ts";
import type { LanguageProvider } from "../lang/language-provider.ts";
import { LangMessages } from "../lang/messages.ts";
import type { LangMessage, ToolWithHandler } from "../lang/messages.ts";

export type ChatInput = LangMessage | LangMessage[];
export type ChatOutput = {
  answer: string;
  messages: LangMessage[];
};

// Custom streaming event type
export interface ChatStreamingEvent {
  type: "streaming";
  data: LangMessages;
}

export class ChatAgent extends Agent<ChatInput, ChatOutput, ChatStreamingEvent> {
  private lang: LanguageProvider;
  private messages: LangMessages;
  private tools?: ToolWithHandler[];

  constructor(languageProvider: LanguageProvider, options?: { tools?: ToolWithHandler[] }) {
    super();
    this.lang = languageProvider;
    this.tools = options?.tools;

    // Create conversation history with tools if provided
    this.messages = new LangMessages([], {
      tools: this.tools,
    });
  }

  protected async runInternal(input: ChatInput): Promise<ChatOutput> {
    // Handle different input types
    if (Array.isArray(input)) {
      // Array of messages - add all to conversation
      for (const message of input) {
        this.messages.push(message);
      }
    } else {
      // Single message - add to conversation
      this.messages.push(input);
    }

    // Agentic loop. Will go in multiple cicles if it is using tools.
    while (true) {
      const response = await this.lang.chat(this.messages, {
        onResult: (result) => {
          this.emit({ type: "streaming", data: result });
        }
      });

      // Update conversation history with the complete response.
      this.messages = response;

      // We continue the loop if the last message is a tool usage results.
      const lastMessage = this.messages[this.messages.length - 1];
      const lastMessageHasToolResults = lastMessage && lastMessage.role === 'tool-results';
      if (!lastMessageHasToolResults) {
        break;
      }
    }

    // Emit finished event with the final response
    const result: ChatOutput = {
      answer: this.messages.answer,
      messages: [...this.messages],
    };

    this.emit({ type: "finished", output: result });
    return result;
  }

  // Optional: handle input processing
  protected inputInternal(input: ChatInput): void {
    // Could add message preprocessing, validation, etc.
  }

  // Helper method to get current conversation
  getConversation(): LangMessages {
    return this.messages;
  }

  // Helper method to clear conversation
  clearConversation(): void {
    this.messages = new LangMessages([], { tools: this.tools });
  }

  // Helper method to add system message
  addSystemMessage(message: string): void {
    this.messages.addSystemMessage(message);
  }

  // Helper method to set tools
  setTools(tools: ToolWithHandler[]): void {
    this.tools = tools;
  }
}
