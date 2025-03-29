import { buildPromptForGettingJSON, PromptForObject } from "./prompt-for-json.ts";
import extractJSON from "./json/extract-json.ts";

/**
 * Definition of a function parameter
 */
export interface FunctionParameter {
  name: string;
  description?: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  enum?: any[];  // List of allowed values for this parameter
  items?: {
    type: "string" | "number" | "boolean" | "object";
    properties?: Record<string, FunctionParameter>;
  };
  properties?: Record<string, FunctionParameter>;
}

/**
 * Definition of a function that can be called by the model
 */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, FunctionParameter>;
}

/**
 * Result of a function call from the model
 */
export interface FunctionCall {
  id?: string;         // Optional ID from the provider (useful for tracking)
  index?: number;      // Index in the tool_calls array (for streaming responses)
  name: string;        // Name of the called function
  arguments: Record<string, any>; // Arguments provided by the model (parsed)
  rawArguments?: string; // Original arguments string (for provider compatibility)
  provider?: string;   // Provider that generated this call (for debugging)
  handled?: boolean;   // Whether this function call has been handled
}

/**
 * Common options for language model requests
 */
export interface LangOptions {
  // Function calling
  functions?: FunctionDefinition[];
  functionHandler?: (call: FunctionCall) => Promise<any>;
  functionCall?: "none" | "auto" | { name: string };  // OpenAI style function selection
  
  // Callback for streaming results
  onResult?: (result: LangResultWithString | LangResultWithMessages) => void;
  
  // Other options 
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  // etc.
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

  abstract ask(
    prompt: string,
    onResultOrOptions?: ((result: LangResultWithString) => void) | LangOptions,
    options?: LangOptions
  ): Promise<LangResultWithString>;

  abstract chat(
    messages: LangChatMessages,
    onResultOrOptions?: ((result: LangResultWithMessages) => void) | LangOptions,
    options?: LangOptions
  ): Promise<LangResultWithMessages>;

  async askForObject(
    promptObj: PromptForObject,
    onResult?: (result: LangResultWithObject) => void,
  ): Promise<LangResultWithObject> {
    let trialsLeft = 3;
    const trials = trialsLeft;
    const prompt = buildPromptForGettingJSON(promptObj);
    const result = new LangResultWithObject(
      prompt,
    );

    while (trialsLeft > 0) {
      trialsLeft--;
      const res = await this.ask(
        prompt,
        (r) => {
          result.answer = r.answer;
          result.finished = r.finished;

          onResult?.(result);
        },
      );

      const jsonObj = extractJSON(res.answer);
      if (jsonObj !== null) {
        result.answerObj = jsonObj;
      }

      if (result.answerObj === null && trialsLeft <= 0) {
        throw new Error(`Failed to parse JSON after ${trials} trials`);
      } else if (result.answerObj === null) {
        console.log(`Failed to parse JSON, trying again...`);
        continue;
      }

      // @TODO: make sure examples themselves have consistent schemas
      const firstExample = promptObj.objectExamples[0];
      const shemasAreMatching = schemasAreMatching(firstExample, result.answerObj);

      if (!shemasAreMatching && trialsLeft <= 0) {
        throw new Error(`The parsed JSON doesn't match the schema after ${trials} trials`);
      } else if (!shemasAreMatching) {
        console.log(`The parsed JSON doesn't match the schema, trying again...`);
        continue;
      }

      break;
    }

    result.finished = true;

    // Calling it one more time after parsing JSON to return a valid JSON string
    onResult?.(result);

    return result;
  }
}

function schemasAreMatching(example: any, target: any): boolean {
  // If both are arrays
  if (Array.isArray(example) && Array.isArray(target)) {
    return true;
  }

  // If both are objects
  if (typeof example === 'object' && typeof target === 'object') {
    const exampleKeys = Object.keys(example);
    const targetKeys = Object.keys(target);

    return exampleKeys.length === targetKeys.length && exampleKeys.every(key => targetKeys.includes(key));
  }

  // If example and target are neither arrays nor objects, they don't match the schema
  return false;
}

interface LangProcessingResult {
  prompt: string;
  finished: boolean;
  thinking?: string;
}

export class LangResultWithString implements LangProcessingResult {
  prompt: string;
  answer: string;
  thinking?: string;
  functionCalls?: FunctionCall[]; // History of function calls
  finished = false;

  constructor(
    prompt: string
  ) {
    this.prompt = prompt;
    this.answer = "";
    this.finished;
  }

  toString(): string {
    return this.answer;
  }

  abort(): void {
    throw new Error("Not implemented yet");
  }
}

export class LangResultWithObject implements LangProcessingResult {
  answerObj: object = {};
  answer = "";
  thinking?: string;
  prompt: string;
  functionCalls?: FunctionCall[]; // History of function calls
  finished = false;

  constructor(
    prompt: string,
  ) {
    this.prompt = prompt;
    this.finished;
  }

  toString(): string {
    if (Object.keys(this.answerObj).length === 0) {
      return this.answer;
    }

    return JSON.stringify(this.answerObj);
  }
}

export type LangChatMessages = {
  role: string;
  content: string;
  // Optional fields for function calling
  name?: string;           // For function message role
  function_call?: {        // OpenAI format
    name: string;
    arguments: string;
  };
  tool_calls?: {           // OpenAI's tool_calls format
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    }
  }[];
  tool_call_id?: string;   // For tool message role
}[];


export class LangResultWithMessages implements LangProcessingResult {
  prompt: string;
  answer: string;
  thinking?: string;
  messages: LangChatMessages = [];
  functionCalls?: FunctionCall[]; // History of function calls
  finished = false;

  constructor(
    messages: LangChatMessages,
  ) {
    // The prompt is the latest message
    this.prompt = messages.length > 0 ? messages[messages.length - 1].content : "";
    this.answer = "";
    this.finished;
  }

  toString(): string {
    return this.answer;
  }

  abort(): void {
    throw new Error("Not implemented yet");
  }
}
