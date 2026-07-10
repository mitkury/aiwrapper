import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";
import { LangOptions } from "../language-provider.ts";
import { models } from 'aimodels';

export type DeepSeekLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  defaultOptions?: LangOptions;
};

export class DeepSeekLang extends OpenAIChatCompletionsLang {
  constructor(options: DeepSeekLangOptions) {
    const modelName = options.model || "deepseek-chat";
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.deepseek.com/v1",
      defaultOptions: options.defaultOptions,
    });
  }

  override supportsReasoning(): boolean {
    const modelInfo = models.id(this._config.model);
    if (modelInfo?.can("reason")) return true;
    const isReasonerModel = this._config.model.toLowerCase().includes("reasoner");
    return isReasonerModel;
  }
} 
