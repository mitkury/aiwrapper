import {
  LangChatMessageCollection,
  LangOptions, LangResult,
  
} from "../language-provider.ts";
import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { models } from 'aimodels';

export type XAILangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class XAILang extends OpenAILikeLang {
  constructor(options: XAILangOptions) {
    const modelName = options.model || "grok-2";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.x.ai/v1",
    });
  }
} 