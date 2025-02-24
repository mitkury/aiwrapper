import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";

export type DeepSeekLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class DeepSeekLang extends OpenAILikeLang {
  constructor(options: DeepSeekLangOptions) {
    const modelName = options.model || "deepseek-chat";
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.deepseek.com/v1",
    });
  }
} 