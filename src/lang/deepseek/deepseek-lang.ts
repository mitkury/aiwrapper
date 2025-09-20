import { OpenAILikeLang, OpenAILikeConfig } from "../openai-like/openai-like-lang.ts";
import { LangOptions } from "../language-provider.ts";
import { LangMessages } from "../messages.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { DecisionOnNotOkResponse, httpRequestWithRetry as fetch } from "../../http-request.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

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

  override supportsReasoning(): boolean {
    const modelInfo = models.id(this._config.model);
    if (modelInfo?.can("reason")) return true;
    const isReasonerModel = this._config.model.toLowerCase().includes("reasoner");
    return isReasonerModel;
  }

  protected override handleStreamData(
    data: any,
    result: LangMessages,
    messages: LangMessages,
    onResult?: (result: LangMessages) => void
  ): void {
    if (data.finished) {
      result.finished = true;
      onResult?.(result);
      return;
    }

    if (data.choices && data.choices[0].delta.reasoning_content) {
      const reasoningContent = data.choices[0].delta.reasoning_content;
      result.thinking = (result.thinking || "") + reasoningContent;
      onResult?.(result);
      return;
    }

    super.handleStreamData(data, result, messages, onResult);
  }
} 