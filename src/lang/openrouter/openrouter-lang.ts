import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";

export type OpenRouterLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  maxCompletionTokens?: number;
  siteUrl?: string; // Optional. Site URL for rankings on openrouter.ai
  siteName?: string; // Optional. Site title for rankings on openrouter.ai
  headers?: Record<string, string>; // Additional custom headers
  bodyProperties?: Record<string, unknown>; // Additional request body properties
};

export class OpenRouterLang extends OpenAIChatCompletionsLang {
  constructor(options: OpenRouterLangOptions) {
    const modelName = options.model || "openai/gpt-5-mini";
    
    // Build headers with OpenRouter-specific optional headers
    const headers: Record<string, string> = {
      ...options.headers,
    };
    
    // Add OpenRouter-specific headers if provided
    if (options.siteUrl) {
      headers["HTTP-Referer"] = options.siteUrl;
    }
    
    if (options.siteName) {
      headers["X-Title"] = options.siteName;
    }
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      maxCompletionTokens: options.maxCompletionTokens,
      baseURL: "https://openrouter.ai/api/v1",
      headers,
      bodyProperties: options.bodyProperties,
    });
  }

}
 