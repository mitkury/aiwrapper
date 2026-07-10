import { OpenAIResponsesLang, type OpenAILangOptions } from "./responses/openai-responses-lang.js";

export type OpenAILangConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
};

export type OpenAIChatMessage = {
  role: "developer" | "user" | "assistant";
  content: string;
};

export class OpenAILang extends OpenAIResponsesLang {
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-5.4";
    super({ ...options, model: modelName });
  }
}
