// Import necessary utilities
import { buildPromptForSchema as _buildPromptForSchema } from "./prompt-for-json.ts";
import extractJSON from "./json/extract-json.ts";

// Note: Object extraction functionality is stubbed for now
// We'll implement it using zod in the future

// Stub for future zod integration
// TODO: Replace with actual zod implementation
const _validateWithZod = (_data: unknown, _schema: unknown): { valid: boolean, errors: string[] } => {
  // This is just a stub that always returns valid for now
  console.log('Schema validation is stubbed and will be implemented with zod');
  return { valid: true, errors: [] };
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
  // Available tools
  tools?: Tool[];
  
  // Streaming callback
  onResult?: (result: LangResult) => void;
  
  // Other options (temperature, etc.)
  [key: string]: any;
}

/**
 * Type for a single chat message
 */
export interface LangChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | any;
}

/**
 * Type for chat messages
 */
export class LangChatMessageCollection extends Array<LangChatMessage> {
  addUserMessage(content: string): this {
    this.push({ role: "user", content });
    return this;
  }

  addAssistantMessage(content: string): this {
    this.push({ role: "assistant", content });
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
   * Converts our simplified schema to a JSON Schema for validation
   * @deprecated Will be replaced with zod in the future
   */
  private schemaToJsonSchema(schema: any): any {
    // Handle array schema
    if (Array.isArray(schema)) {
      if (schema.length === 0) {
        return {
          type: "array",
          items: {}
        };
      }
      
      // Use the first item as the template for array items
      return {
        type: "array",
        items: this.convertObjectToJsonSchema(schema[0])
      };
    }
    
    // Handle object schema
    return this.convertObjectToJsonSchema(schema);
  }
  
  /**
   * Recursive helper to convert object properties to JSON Schema
   * @deprecated Will be replaced with zod in the future
   */
  private convertObjectToJsonSchema(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return this.getTypeSchema(obj);
    }
    
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    Object.entries(obj).forEach(([key, value]) => {
      properties[key] = this.getPropertySchema(value);
      required.push(key);
    });
    
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false
    };
  }
  
  /**
   * Get JSON Schema for a property based on value type
   * @deprecated Will be replaced with zod in the future
   */
  private getPropertySchema(value: any): any {
    if (value === null) {
      return { type: "null" };
    }
    
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return { type: "array" };
      }
      
      return {
        type: "array",
        items: this.getPropertySchema(value[0])
      };
    }
    
    if (typeof value === 'object') {
      return this.convertObjectToJsonSchema(value);
    }
    
    return this.getTypeSchema(value);
  }
  
  /**
   * Get JSON Schema type definition based on the type of value
   * @deprecated Will be replaced with zod in the future
   */
  private getTypeSchema(value: any): any {
    switch (typeof value) {
      case 'string':
        return { type: "string" };
      case 'number':
        return { type: "number" };
      case 'boolean':
        return { type: "boolean" };
      default:
        return {};
    }
  }
  
  /**
   * Validate that a target conforms to a schema
   * @deprecated Will be replaced with zod in the future
   */
  private validateSchema(_schema: object | object[], _target: object | object[]): { valid: boolean, errors: any[] } {
    // Simple validation stub for now
    // This will be replaced with zod in the future
    
    // Just return valid for now since this is a stub
    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Get structured answer from a language model
   * Uses a schema-based approach
   * @deprecated Current implementation will be replaced with zod in the future
   */
  async askForObject<T>(
    prompt: string | LangChatMessage[] | LangChatMessageCollection,
    _schema: object | object[],
    options?: LangOptions,
  ): Promise<LangResult> {
    // Simplified implementation for now
    // This will be replaced with zod in the future
    
    // Create a message collection with the prompt
    const messages = new LangChatMessageCollection();
    
    if (typeof prompt === 'string') {
      messages.addUserMessage(`Generate JSON with this structure: ${JSON.stringify(_schema)}. Prompt: ${prompt}`);
    } else if (Array.isArray(prompt)) {
      // Just use the messages as is for now
      if (prompt instanceof LangChatMessageCollection) {
        return this.ask("This API is being updated to use zod. Please use the regular ask method for now.", options);
      } else {
        // Create a collection but don't use it - just for demonstration
        const _collection = new LangChatMessageCollection(...prompt);
        return this.ask("This API is being updated to use zod. Please use the regular ask method for now.", options);
      }
    }
    
    // Just use the regular ask method for now
    return this.ask("This API is being updated to use zod. Please use the regular ask method for now.", options);
  }
  
  /**
   * Helper method to process object extraction requests
   * @deprecated Will be replaced with zod in the future
   */
  private async processObjectRequest(
    messages: LangChatMessageCollection,
    _schema: object | object[],
    options?: LangOptions,
  ): Promise<LangResult> {
    // Simplified implementation for now
    // Just use the chat method directly
    const result = await this.chat(messages, options);
    
    // Try to extract JSON from the response
    try {
      const jsonObj = extractJSON(result.answer);
      if (jsonObj !== null) {
        result.object = jsonObj;
      }
    } catch (error) {
      console.error("Failed to extract JSON", error);
    }
    
    result.finished = true;
    options?.onResult?.(result);
    
    return result;
  }
}
