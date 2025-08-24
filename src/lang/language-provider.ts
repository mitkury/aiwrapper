// Import necessary utilities
import extractJSON from "./json/extract-json.ts";
import { z } from 'zod';
import {  
  validateAgainstSchema 
} from "./schema/schema-utils.ts";
import { LangMessages } from "./messages.ts";
import type { LangChatMessage } from "./messages.ts";

// Export zod for convenience
export { z };

/**
 * Type for any supported schema (Zod or JSON Schema)
 */
export type Schema = z.ZodType | Record<string, unknown>;

// Re-export message types from messages.ts to keep public API stable (collection is internal but used across src)
export { LangChatMessageCollection } from "./messages.ts";
export type { LangChatMessage, LangContentPart, LangImageInput } from "./messages.ts";

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
 * Interface for tool requests that can be sent to language models
 */
export interface ToolRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Interface for tool execution results
 */
export interface ToolResult {
  toolId: string;
  result: any;
}

/**
 * Interface for tool definitions that can be passed to language models
 */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

/**
 * Options that can be passed to language model methods
 */
export interface LangOptions {
  schema?: Schema;
  
  // Streaming callback
  onResult?: (result: LangMessages) => void;
  
  // Preferred image output format if the provider can generate images
  imageOutput?: "auto" | "url" | "base64";
  
  // Other options (temperature, etc.)
  [key: string]: any;
}

/**
 * Backward-compatible result class that is also the conversation object
 * Extends LangMessages and exposes a 'messages' getter for old code.
 */
export class LangResult extends LangMessages {
  constructor(messages: LangMessages | LangChatMessage[]) {
    super(Array.isArray(messages) ? messages as LangChatMessage[] : [...(messages as LangMessages)]);
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
    messages: LangChatMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages>;

  /**
   * Get structured answer from a language model
   * Supports both Zod schemas and JSON Schema objects
   */
  async askForObject(
    prompt: string | LangChatMessage[] | LangMessages,
    schema: Schema,
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

    // Post-process: try to parse JSON object from the answer and validate
    const maybeObject = extractJSON(result.answer);
    if (maybeObject !== null) {
      const validation = validateAgainstSchema(maybeObject, schema);
      if (validation.valid) {
        result.object = maybeObject;
        result.validationErrors = [];
      } else {
        result.object = null;
        result.validationErrors = validation.errors;
      }
    } else {
      // Could not parse JSON
      result.object = null;
      result.validationErrors = ["Failed to parse JSON from the model response"];
    }

    return result;
  }
}
