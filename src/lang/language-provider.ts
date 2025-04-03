import { buildPromptForGettingJSON, PromptForObject } from "./prompt-for-json.ts";
import extractJSON from "./json/extract-json.ts";

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
 * Type for chat messages
 */
export type LangChatMessages = {
  role: string;
  content: string | any;
}[];

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
  messages: LangChatMessages;
  
  // Whether the processing is finished
  finished: boolean = false;
  
  // Thinking/reasoning output (if available)
  thinking?: string;

  constructor(messages: LangChatMessages) {
    this.messages = messages;
  }

  /**
   * Add a user message to the conversation history
   */
  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }
  
  /**
   * Add tool execution results back to the conversation
   */
  addToolUseMessage(toolResults: ToolResult[]): void {
    // @TODO: Implement proper tool results handling based on provider format
    this.messages.push({ role: "tool", content: toolResults });
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
    messages: LangChatMessages,
    options?: LangOptions,
  ): Promise<LangResult>;

  /**
   * Helper function to check if schemas match
   */
  private schemasAreMatching(example: any, target: any): boolean {
    // If both are arrays
    if (Array.isArray(example) && Array.isArray(target)) {
      return true;
    }

    // If both are objects
    if (typeof example === 'object' && example !== null && typeof target === 'object' && target !== null) {
      const exampleKeys = Object.keys(example);
      const targetKeys = Object.keys(target);

      return exampleKeys.length === targetKeys.length && exampleKeys.every(key => targetKeys.includes(key));
    }

    // If example and target are neither arrays nor objects, they don't match the schema
    return false;
  }

  /**
   * Directly get structured data
   */
  async askForObject<T extends object>(
    prompt: string | LangChatMessages,
    schema: T,
    options?: LangOptions,
  ): Promise<LangResult> {
    // @TODO: Support the messages overload for askForObject

    // For now, we only support string prompts
    if (typeof prompt !== 'string') {
      throw new Error("askForObject with message array is not implemented yet");
    }

    // Build a prompt for getting JSON
    const promptObj: PromptForObject = {
      title: "Extract Structured Data",
      description: "Extract the requested information in structured format",
      instructions: [typeof prompt === "string" ? prompt : "Extract structured data"],
      objectExamples: Array.isArray(schema) ? schema : [schema as object],
    };
    
    const jsonPrompt = buildPromptForGettingJSON(promptObj);
    
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

      // Make sure examples themselves have consistent schemas
      const firstExample = promptObj.objectExamples[0];
      const schemasAreMatching = this.schemasAreMatching(firstExample, result.object);

      if (!schemasAreMatching && trialsLeft <= 0) {
        throw new Error(`The parsed JSON doesn't match the schema after ${trials} trials`);
      } else if (!schemasAreMatching) {
        console.log(`The parsed JSON doesn't match the schema, trying again...`);
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
