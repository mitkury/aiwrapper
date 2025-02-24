import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";

export type GroqLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
};

export class GroqLang extends OpenAILikeLang {
  constructor(options: GroqLangOptions) {
    const modelName = options.model || "llama3-70b-8192";
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
}
