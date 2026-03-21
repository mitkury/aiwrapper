import type { LangOptions } from "../language-provider.ts";
import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";

export type MistralLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  defaultOptions?: LangOptions;
};

export class MistralLang extends OpenAIChatCompletionsLang {
  constructor(options: MistralLangOptions) {
    const modelName = options.model || "mistral-large-latest";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.mistral.ai/v1",
      defaultOptions: options.defaultOptions,
    });
    
    // For Mistral, we require the model to be in aimodels database
    if (!this.modelInfo) {
      console.error(`Invalid Mistral model: ${modelName}. Model not found in aimodels database.`);
    }
  }
} 
