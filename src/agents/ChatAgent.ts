import { Agent } from "./agent.ts";
import type { LanguageProvider } from "../lang/language-provider.ts";
import { LangMessages } from "../lang/messages.ts";
import type { LangMessage } from "../lang/messages.ts";

export type ChatInput = LangMessage | LangMessage[];
export type ChatOutput = {
  answer: string;
  messages: LangMessage[];
};

export class ChatAgent extends Agent<ChatInput, ChatOutput> {
  private languageProvider: LanguageProvider;
  private conversationHistory: LangMessages;

  constructor(languageProvider: LanguageProvider) {
    super();
    this.languageProvider = languageProvider;
    this.conversationHistory = new LangMessages();
  }

  protected async runInternal(input: ChatInput): Promise<ChatOutput> {
    // Handle different input types
    if (Array.isArray(input)) {
      // Array of messages - add all to conversation
      for (const message of input) {
        this.conversationHistory.push(message);
      }
    } else {
      // Single message - add to conversation
      this.conversationHistory.push(input);
    }

    // Get response from language provider
    const response = await this.languageProvider.chat(this.conversationHistory);

    // Add assistant response to conversation history
    if (response.length > 0) {
      this.conversationHistory.push(response[response.length - 1]);
    }

    // Emit finished event with the response
    const result: ChatOutput = {
      answer: response.answer,
      messages: [...this.conversationHistory],
    };

    this.emit({ type: "finished", output: result });
    return result;
  }

  // Optional: handle input processing
  protected inputInternal(input: ChatInput): void {
    // Could add message preprocessing, validation, etc.
    console.log("Processing chat input:", input);
  }

  // Helper method to get current conversation
  getConversation(): LangMessages {
    return this.conversationHistory;
  }

  // Helper method to clear conversation
  clearConversation(): void {
    this.conversationHistory = new LangMessages();
  }

  // Helper method to add system message
  addSystemMessage(message: string): void {
    this.conversationHistory.addSystemMessage(message);
  }
}
