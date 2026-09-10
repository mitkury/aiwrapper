import type { LangOptions } from "../language-provider.js";
import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.js";

export type XAILangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  defaultOptions?: LangOptions;
};

export class XAILang extends OpenAIChatCompletionsLang {
  constructor(options: XAILangOptions) {
    const modelName = options.model || "grok-2";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.x.ai/v1",
      defaultOptions: options.defaultOptions,
    });
  }
} 
