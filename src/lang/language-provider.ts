import { z } from 'zod';
import { LangMessages } from "./messages.js";
import type { LangMessage, LangMessageItem, LangMessageRole, LangTool } from "./messages.js";

// Export zod for convenience
export { z };

/**
 * Type for any supported schema (Zod or JSON Schema)
 */
export type LangResponseSchema = z.ZodType | Record<string, unknown>;

// Re-export message types from messages.ts to keep public API stable
export type {
  LangMessage,
  LangContentPart,
  LangContentImage as LangImageInput,
  LangImageOutput,
} from "./messages.js";

/**
 * Options that can be passed to language model methods
 */
export interface LangOptions {
  schema?: LangResponseSchema;
  
  // Streaming callback
  onResult?: (result: LangMessage) => void;

  // Optional AbortSignal to cancel requests/streams
  signal?: AbortSignal;

  // Tools for this request. Overrides LangMessages.availableTools, including
  // when an empty array is provided to disable tools for one turn.
  tools?: LangTool[];

  providerSpecificBody?: Record<string, any>;
  providerSpecificHeaders?: Record<string, string>;
}

/**
 * Backward-compatible result class that is also the conversation object
 * Extends LangMessages and exposes a 'messages' getter for old code.
 */
export class LangResult extends LangMessages {
  constructor(messages: LangMessages | LangMessage[]) {
    super(messages);
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
  protected readonly defaultOptions?: LangOptions;

  constructor(name: string, defaultOptions?: LangOptions) {
    this.name = name;
    this.defaultOptions = defaultOptions;
  }

  protected resolveOptions(options?: LangOptions): LangOptions | undefined {
    if (!this.defaultOptions && !options) {
      return undefined;
    }

    return {
      ...(this.defaultOptions ?? {}),
      ...(options ?? {}),
    };
  }

  /**
   * Reset per-request state when an existing conversation is sent again.
   */
  protected beginRequest<T extends LangMessages>(messages: T): T {
    messages.finished = false;
    messages.aborted = false;
    return messages;
  }

  protected resolveTools(
    messages: LangMessages,
    options?: LangOptions,
  ): LangTool[] | undefined {
    return options?.tools !== undefined
      ? options.tools
      : messages.availableTools;
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
