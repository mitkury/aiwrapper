import {
  LangChatMessages,
  LangResultWithMessages,
  LangResultWithString,
} from "../language-provider.ts";
import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { models } from 'aimodels';

export type OpenAILangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

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

export class OpenAILang extends OpenAILikeLang {
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-4o";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.openai.com/v1",
    });
    
    // For OpenAI, we require the model to be in aimodels database
    if (!this.modelInfo) {
      console.error(`Invalid OpenAI model: ${modelName}. Model not found in aimodels database.`);
    }
  }

  protected override transformMessages(messages: LangChatMessages): LangChatMessages {
    return messages.map((message) => {
      if (message.role === "system" && this._config.model.includes("o1")) {
        return { ...message, role: "user" };
      }
      else if (message.role === "system") {
        return { ...message, role: "developer" };
      }
      return message;
    });
  }

  protected override transformBody(body: Record<string, unknown>): Record<string, unknown> {
    // OpenAI now uses max_completion_tokens instead of max_tokens
    if (body.max_tokens) {
      const { max_tokens, ...rest } = body;
      return {
        ...rest,
        max_completion_tokens: max_tokens
      };
    }
    return body;
  }
}
