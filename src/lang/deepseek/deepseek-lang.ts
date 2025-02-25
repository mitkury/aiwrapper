import { OpenAILikeLang, OpenAILikeConfig } from "../openai-like/openai-like-lang.ts";
import { LangChatMessages, LangResultWithMessages } from "../language-provider.ts";
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
  private supportsReasoning(): boolean {
    // Check if the model has reasoning capability in aimodels
    const modelInfo = models.id(this._config.model);

    console.log(JSON.stringify(modelInfo, null, 2));

    // First check if the model has the "reason" capability
    if (modelInfo?.can?.includes("reason")) {
      return true;
    }

    // As a fallback, check if the model name contains "reasoner" 
    // This is a heuristic in case the model info is not up-to-date
    const isReasonerModel = this._config.model.toLowerCase().includes("reasoner");

    return isReasonerModel;
  }

  override async chat(
    messages: LangChatMessages,
    onResult?: (result: LangResultWithMessages) => void,
  ): Promise<LangResultWithMessages> {
    // Check if the model supports reasoning
    const modelSupportsReasoning = this.supportsReasoning();

    // If the model doesn't support reasoning, use the parent implementation
    if (!modelSupportsReasoning) {
      return super.chat(messages, onResult);
    }

    console.log("Model supports reasoning:", modelSupportsReasoning);

    const result = new LangResultWithMessages(messages);
    const transformedMessages = this.transformMessages(messages);

    const requestMaxTokens = this.modelInfo
      ? calculateModelResponseTokens(
        this.modelInfo,
        transformedMessages,
        this._config.maxTokens
      )
      : this._config.maxTokens || 4000;

    let reasoningContent = "";

    const onData = (data: any) => {
      console.log("Data:", data);

      if (data.finished) {
        result.thinking = reasoningContent;
        result.finished = true;
        onResult?.(result);
        return;
      }

      if (data.choices && data.choices[0].delta.reasoning_content) {
        reasoningContent += data.choices[0].delta.reasoning_content;
        result.thinking = reasoningContent;
        onResult?.(result);
        return;
      }

      if (data.choices !== undefined) {
        const deltaContent = data.choices[0].delta.content
          ? data.choices[0].delta.content
          : "";

        result.answer += deltaContent;

        result.messages = [...messages, {
          role: "assistant",
          content: result.answer,
        }];

        onResult?.(result);
      }
    };

    const body = this.transformBody({
      model: this._config.model,
      messages: transformedMessages,
      stream: true,
      max_tokens: requestMaxTokens,
    });

    const response = await fetch(`${this._config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._config.apiKey}`,
        ...this._config.headers,
      },
      body: JSON.stringify(body),
      onNotOkResponse: async (
        res,
        decision,
      ): Promise<DecisionOnNotOkResponse> => {
        if (res.status === 401) {
          decision.retry = false;
          throw new Error(
            "API key is invalid. Please check your API key and try again.",
          );
        }

        if (res.status === 400) {
          const data = await res.text();
          decision.retry = false;
          throw new Error(data);
        }

        return decision;
      },
    }).catch((err) => {
      throw new Error(err);
    });

    await processResponseStream(response, onData);

    return result;
  }
} 