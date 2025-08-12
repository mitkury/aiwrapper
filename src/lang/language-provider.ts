// Import necessary utilities
import extractJSON from "./json/extract-json.ts";
import { z } from 'zod';
import {  
  validateAgainstSchema 
} from "./schema/schema-utils.ts";

// Export zod for convenience
export { z };

/**
 * Type for any supported schema (Zod or JSON Schema)
 */
export type Schema = z.ZodType | Record<string, unknown>;


/**
 * Image input types for multimodal prompts
 */
export type LangImageInput =
  | { kind: "url"; url: string }
  | { kind: "base64"; base64: string; mimeType?: string }
  | { kind: "bytes"; bytes: ArrayBuffer | Uint8Array; mimeType?: string }
  | { kind: "blob"; blob: Blob; mimeType?: string };

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
 * Mixed content parts for messages (text + images)
 */
export type LangContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: LangImageInput; alt?: string };


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
  // Available tools
  tools?: Tool[];

  schema?: Schema;
  
  // Streaming callback
  onResult?: (result: LangResult) => void;
  
  // Preferred image output format if the provider can generate images
  imageOutput?: "auto" | "url" | "base64";
  
  // Other options (temperature, etc.)
  [key: string]: any;
}

/**
 * Type for a single chat message
 */
export interface LangChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  // Supports simple string content for backward compatibility, or a list of structured parts
  content: string | LangContentPart[] | any;
}

/**
 * Type for chat messages
 */
export class LangChatMessageCollection extends Array<LangChatMessage> {
  addUserMessage(content: string): this {
    this.push({ role: "user", content });
    return this;
  }

  addUserContent(parts: LangContentPart[]): this {
    this.push({ role: "user", content: parts });
    return this;
  }

  addUserImage(image: LangImageInput, alt?: string): this {
    const parts: LangContentPart[] = [{ type: "image", image, alt }];
    return this.addUserContent(parts);
  }

  addAssistantMessage(content: string): this {
    this.push({ role: "assistant", content });
    return this;
  }

  addAssistantContent(parts: LangContentPart[]): this {
    this.push({ role: "assistant", content: parts });
    return this;
  }

  addToolUseMessage(toolResults: any): this {
    this.push({ role: "tool", content: toolResults });
    return this;
  }

  addSystemMessage(content: string): this {
    this.push({ role: "system", content });
    return this;
  }
}

/**
 * Unified result class for all language model operations
 */
export class LangResult {
  // The text answer from the LLM
  answer: string = "";
  
  // Parsed object (if schema was provided)
  object: any | null = null;
  
  // Tool calls requested by the model (if applicable)
  tools: ToolRequest[] | null = null;
  
  // The full conversation history including the AI's response
  messages: LangChatMessageCollection;
  
  // Whether the processing is finished
  finished: boolean = false;
  
  // Thinking/reasoning output (if available)
  thinking?: string;

  // Schema validation errors, if any
  validationErrors: string[] = [];

  // Images generated/returned by the model (if any)
  images?: LangImageOutput[];

  constructor(messages: LangChatMessageCollection) {
    this.messages = messages;
  }

  /**
   * Add a user message to the conversation history
   */
  addUserMessage(content: string): void {
    this.messages.addUserMessage(content);
  }
  
  /**
   * Add tool execution results back to the conversation
   */
  addToolUseMessage(toolResults: ToolResult[]): void {
    this.messages.addToolUseMessage(toolResults);
  }

  /**
   * Add assistant message to the conversation history
   */
  addAssistantMessage(content: string): void {
    this.messages.addAssistantMessage(content);
  }

  /**
   * Add system message to the conversation history
   */
  addSystemMessage(content: string): void {
    this.messages.addSystemMessage(content);
  }

  toString(): string {
    return this.answer;
  }

  /**
   * Abort the current processing (for streaming)
   */
  abort(): void {
    throw new Error("Not implemented yet");
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
  ): Promise<LangResult>;

  /**
   * Continue a conversation
   */
  abstract chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult>;

  /**
   * Get structured answer from a language model
   * Supports both Zod schemas and JSON Schema objects
   */
  async askForObject(
    prompt: string | LangChatMessage[] | LangChatMessageCollection,
    schema: Schema,
    options?: LangOptions,
  ): Promise<LangResult> {
    // Create a message collection with the prompt
    let messages: LangChatMessageCollection;
    
    if (typeof prompt === 'string') {
      messages = new LangChatMessageCollection();
      messages.addUserMessage(prompt);
    } else if (Array.isArray(prompt)) {
      if (prompt instanceof LangChatMessageCollection) {
        messages = prompt;
      } else {
        messages = new LangChatMessageCollection(...prompt);
      }
    } else {
      throw new Error("Prompt must be a string or an array of messages");
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
