import { z } from 'zod';
import { LangMessages } from "./messages.ts";
import type { LangMessage, LangMessageContent, LangMessageItem, LangMessageRole } from "./messages.ts";

// Export zod for convenience
export { z };

/**
 * Type for any supported schema (Zod or JSON Schema)
 */
export type LangResponseSchema = z.ZodType | Record<string, unknown>;

// Re-export message types from messages.ts to keep public API stable
export type { LangMessage, LangContentPart, LangContentImage as LangImageInput } from "./messages.ts";

/**
 * Image output type for providers that can generate images
 */
export type LangImageOutput = {
  url?: string;
  base64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Options that can be passed to language model methods
 */
export interface LangOptions {
  schema?: LangResponseSchema;
  
  // Streaming callback
  onResult?: (result: LangMessage) => void;

  // Optional AbortSignal to cancel requests/streams
  signal?: AbortSignal;

  providerSpecificBody?: Record<string, any>;
  providerSpecificHeaders?: Record<string, string>;
}

/**
 * Backward-compatible result class that is also the conversation object
 * Extends LangMessages and exposes a 'messages' getter for old code.
 */
export class LangResult extends LangMessages {
  constructor(messages: LangMessages | LangMessage[]) {
    super(Array.isArray(messages) ? messages as LangMessage[] : [...(messages as LangMessages)]);
  }

  get messages(): this {
    return this;
  }
}

/**
 * LanguageProvider is an abstract class that represents a language model and
 * its basic functionality.
 */
export abstract class LanguageProvider {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Simple text generation
   */
  abstract ask(
    prompt: string,
    options?: LangOptions,
  ): Promise<LangMessages>;

  /**
   * Continue a conversation
   */
  abstract chat(
    messages: { role: LangMessageRole; items: LangMessageItem[] }[] | LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages>;

  /**
   * Get structured answer from a language model
   * Supports both Zod schemas and JSON Schema objects
   */
  async askForObject(
    prompt: string | { role: LangMessageRole; items: LangMessageItem[] }[] | LangMessage[] | LangMessages,
    schema: LangResponseSchema,
    options?: LangOptions,
  ): Promise<LangMessages> {
    // Create a message collection with the prompt
    let messages: LangMessages;
    
    if (typeof prompt === 'string') {
      messages = new LangMessages();
      messages.addUserMessage(prompt);
    } else if (prompt instanceof LangMessages) {
      messages = prompt;
    } else {
      messages = new LangMessages(prompt);
    }

    // Call chat with schema to allow providers to use native structured output options
    const result = await this.chat(messages, { ...options, schema });

    return result;
  }
}
