import { OpenAILikeLang, OpenAILikeConfig } from "../openai-like/openai-like-lang.ts";
import { LangChatMessageCollection, LangOptions, LangResult } from "../language-provider.ts";
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

  // Check if the model supports reasoning
  override supportsReasoning(): boolean {
    // Check if the model has reasoning capability in aimodels
    const modelInfo = models.id(this._config.model);

    // First check if the model has the "reason" capability
    if (modelInfo?.can("reason")) {
      return true;
    }

    // As a fallback, check if the model name contains "reasoner" 
    // This is a heuristic in case the model info is not up-to-date
    const isReasonerModel = this._config.model.toLowerCase().includes("reasoner");

    return isReasonerModel;
  }

  /**
   * Override the handleStreamData method to capture reasoning content
   */
  protected override handleStreamData(
    data: any,
    result: LangResult,
    messages: LangChatMessageCollection,
    onResult?: (result: LangResult) => void
  ): void {
    if (data.finished) {
      result.finished = true;
      onResult?.(result);
      return;
    }

    // Handle reasoning content if available (DeepSeek specific)
    if (data.choices && data.choices[0].delta.reasoning_content) {
      const reasoningContent = data.choices[0].delta.reasoning_content;
      result.thinking = (result.thinking || "") + reasoningContent;
      onResult?.(result);
      return;
    }

    // Fall back to standard content handling from the parent class
    super.handleStreamData(data, result, messages, onResult);
  }
} 