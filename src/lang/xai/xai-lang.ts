import {
  LangOptions, LangResult,
} from "../language-provider.ts";
import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";
import { models } from 'aimodels';

export type XAILangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
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
    });
  }
} 