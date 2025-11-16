import { OpenAIChatCompletionsLang, OpenAILikeConfig } from "../openai/openai-chat-completions-lang.ts";
import { LangOptions, LangMessage } from "../language-provider.ts";
import { LangMessages } from "../messages.ts";
import { processServerEvents } from "../../process-server-events.ts";
import { httpRequestWithRetry as fetch } from "../../http-request.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type DeepSeekLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
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
    onResult?: (result: LangMessage) => void
  ): void {
    if (data.finished) {
      result.finished = true;
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last) onResult?.(last);
      return;
    }

    if (data.choices && data.choices[0].delta.reasoning_content) {
      const reasoningContent = data.choices[0].delta.reasoning_content;
      /*
      const msg = result.appendToAssistantThinking(reasoningContent);
      if (msg) onResult?.(msg);
      */
      return;
    }

    super.handleStreamData(data, result, onResult);
  }
} 