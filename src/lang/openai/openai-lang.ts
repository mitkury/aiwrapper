import { OpenAIResponsesLang, OpenAILangOptions } from "./responses/openai-responses-lang.ts";

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
    super({ ...options, model: modelName });
  }
}
