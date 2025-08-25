import { OpenAIResponsesLang } from "./openai-responses-lang.ts";

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

export class OpenAILang extends OpenAIResponsesLang {
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-5-mini";
    super({ apiKey: options.apiKey, model: modelName, systemPrompt: options.systemPrompt });
  }
}
