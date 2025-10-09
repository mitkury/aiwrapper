import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";

export type OpenRouterLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class OpenRouterLang extends OpenAIChatCompletionsLang {
  constructor(options: OpenRouterLangOptions) {
    const modelName = options.model || "openai/gpt-3.5-turbo";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

}
 