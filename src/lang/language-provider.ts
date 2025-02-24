import { buildPromptForGettingJSON, PromptForObject } from "./prompt-for-json.ts";
import extractJSON from "./json/extract-json.ts";

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
    onResult: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString>;

  abstract chat(
    messages: LangChatMessages,
    onResult: (result: LangResultWithMessages) => void,
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
}

export class LangResultWithString implements LangProcessingResult {
  prompt: string;
  answer: string;
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
  prompt: string;
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
}[];


export class LangResultWithMessages implements LangProcessingResult {
  prompt: string;
  answer: string;
  messages: LangChatMessages = [];
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
