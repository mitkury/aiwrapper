import { buildPromptForSchema } from "./prompt-for-json.ts";
import extractJSON from "./json/extract-json.ts";
import { Validator } from "jsonschema";

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
  role: "user" | "assistant" | "tool";
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
    messages: LangChatMessage[],
    options?: LangOptions,
  ): Promise<LangResult>;

  /**
   * Converts our simplified schema to a JSON Schema for validation
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
   */
  private validateSchema(schema: object | object[], target: object | object[]): { valid: boolean, errors: any[] } {
    const validator = new Validator();
    
    // Check if the schema is already in JSON Schema format
    const isJsonSchema = typeof schema === 'object' && 
      !Array.isArray(schema) && 
      ('type' in schema || ('properties' in schema && !Array.isArray((schema as any).properties)));
    
    const jsonSchema = isJsonSchema
      ? schema  // Already in JSON Schema format
      : this.schemaToJsonSchema(schema);  // Convert to JSON Schema
      
    const result = validator.validate(target, jsonSchema);
    
    return {
      valid: result.valid,
      errors: result.errors
    };
  }

  // @TODO: consider calling askWithSchema instead?
  /**
   * Get structured answer from a language model
   * Uses a schema-based approach
   */
  async askForObject(
    prompt: string | LangChatMessage[],
    schema: object | object[],
    options?: LangOptions,
  ): Promise<LangResult> {
    // Handle message array prompts
    if (Array.isArray(prompt)) {
      const messages = prompt as LangChatMessageCollection;
      // @TODO: Implement proper messaging for structured output
      throw new Error("askForObject with message array is not implemented yet");
    }
    
    // For now, we only support string prompts
    if (typeof prompt !== 'string') {
      throw new Error("askForObject with message array is not implemented yet");
    }
    
    // @TODO: check if the model supports structured output and use that instead of the prompt

    // Build a prompt with the schema
    const jsonPrompt = buildPromptForSchema(prompt, schema);
    
    // Create options with the callback if provided
    const askOptions: LangOptions = {
      ...options,
    };
    
    let trialsLeft = 3;
    const trials = trialsLeft;
    
    let result: LangResult | null = null;
    
    while (trialsLeft > 0) {
      trialsLeft--;
      result = await this.ask(jsonPrompt, askOptions);

      const jsonObj = extractJSON(result.answer);
      if (jsonObj !== null) {
        result.object = jsonObj;
      }

      if (result.object === null && trialsLeft <= 0) {
        throw new Error(`Failed to parse JSON after ${trials} trials`);
      } else if (result.object === null) {
        console.log(`Failed to parse JSON, trying again...`);
        continue;
      }

      // Validate the response against the schema
      const { valid, errors } = this.validateSchema(schema, result.object);

      if (!valid && trialsLeft <= 0) {
        const errorDetails = errors.length > 0 
          ? ` Validation errors: ${JSON.stringify(errors)}`
          : '';
        throw new Error(`The parsed JSON doesn't match the schema after ${trials} trials.${errorDetails}`);
      } else if (!valid) {
        console.log(`The parsed JSON doesn't match the schema, trying again... Errors: ${JSON.stringify(errors)}`);
        continue;
      }

      break;
    }

    if (!result) {
      throw new Error("Failed to get a result from the language model");
    }

    result.finished = true;
    options?.onResult?.(result);

    return result;
  }
}
