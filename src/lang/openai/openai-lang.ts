import { OpenAIResponsesLangTwo } from "./responses/openai-responses-lang-two.ts";

export type OpenAILangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

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

export class OpenAILang extends OpenAIResponsesLangTwo {
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-5-mini";
    super({ apiKey: options.apiKey, model: modelName, systemPrompt: options.systemPrompt });
  }
}
