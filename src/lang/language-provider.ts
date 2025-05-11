// Import necessary utilities
import extractJSON from "./json/extract-json.ts";
import { z } from 'zod';
import { 
  schemaToDescription, 
  validateAgainstSchema 
} from "./schema/schema-utils.ts";

// Export zod for convenience
export { z };

/**
 * Type for any supported schema (Zod or JSON Schema)
 */
export type Schema = z.ZodType | Record<string, unknown>;


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
   * Supports both Zod schemas and JSON Schema objects
   */
  async askForObject<T>(
    prompt: string | LangChatMessage[] | LangChatMessageCollection,
    schema: Schema,
    options?: LangOptions,
  ): Promise<LangResult> {
    // Create a message collection with the prompt
    let messages: LangChatMessageCollection;
    
    if (typeof prompt === 'string') {
      messages = new LangChatMessageCollection();
      
      // Convert the schema to a human-readable description
      const schemaDesc = schemaToDescription(schema);
      
      // Create a prompt that includes the schema description
      messages.addUserMessage(`Generate a JSON object that is ${schemaDesc}. The JSON should be valid and follow this request: ${prompt}`);
    } else if (Array.isArray(prompt)) {
      // Convert to LangChatMessageCollection if it's a regular array
      if (prompt instanceof LangChatMessageCollection) {
        messages = prompt;
      } else {
        messages = new LangChatMessageCollection(...prompt);
      }
      
      // Add a message asking for structured output
      const schemaDesc = schemaToDescription(schema);
      messages.addUserMessage(`Please provide your response as a JSON object that is ${schemaDesc}.`);
    } else {
      throw new Error("Prompt must be a string or an array of messages");
    }
    
    // Process the request
    const result = await this.chat(messages, options);
    
    // Try to extract JSON from the response
    try {
      const jsonObj = extractJSON(result.answer);
      if (jsonObj !== null) {
        // Validate the extracted JSON against the schema
        const validation = validateAgainstSchema(jsonObj, schema);
        
        if (validation.valid) {
          result.object = jsonObj;
        } else {
          console.warn(`Schema validation failed: ${validation.errors.join(', ')}`);
          // Still set the object even if validation fails
          result.object = jsonObj;
        }
      }
    } catch (error) {
      console.error("Failed to extract or validate JSON", error);
    }
    
    result.finished = true;
    options?.onResult?.(result);
    
    return result;
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
