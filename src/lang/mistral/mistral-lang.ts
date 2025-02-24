import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { models } from 'aimodels';

export type MistralLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class MistralLang extends OpenAILikeLang {
  constructor(options: MistralLangOptions) {
    const modelName = options.model || "mistral-large-latest";
    
    super({
      apiKey: options.apiKey,
      name: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.mistral.ai/v1",
    });
    
    // For Mistral, we require the model to be in aimodels database
    if (!this.modelInfo) {
      console.error(`Invalid Mistral model: ${modelName}. Model not found in aimodels database.`);
    }
  }
} 