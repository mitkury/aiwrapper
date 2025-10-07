import { Agent } from "./agent.ts";
import type { LanguageProvider, LangOptions } from "../lang/language-provider.ts";
import { LangMessages } from "../lang/messages.ts";
import type { LangMessage, ToolWithHandler } from "../lang/messages.ts";

export type ChatInput = LangMessage | LangMessage[];
export type ChatOutput = {
  answer: string;
  messages: LangMessage[];
};

export class ChatAgent extends Agent<ChatInput, ChatOutput> {
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
      // Get response from language provider (tools are already set in conversationHistory)
      const response = await this.lang.chat(this.messages);

      // Update conversation history with the complete response
      // The response contains all messages including tool calls and results
      // But we need to preserve the availableTools since response might not have them
      this.messages = response;

      // We continue the loop if the last message is a tool results.
      // In that case, we need to get the model's response to the tool results.
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
