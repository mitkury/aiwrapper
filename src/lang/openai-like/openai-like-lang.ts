import {
  LangChatMessages,
  LangResultWithMessages,
  LangResultWithString,
  LanguageProvider,
} from "../language-provider.ts";
import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type OpenAILikeConfig = {
  apiKey: string;
  name: string;
  systemPrompt: string;
  maxTokens?: number;
  baseURL: string;
  headers?: Record<string, string>;
};

export abstract class OpenAILikeLang extends LanguageProvider {
  protected _config: OpenAILikeConfig;
  protected modelInfo?: Model;

  constructor(config: OpenAILikeConfig) {
    super(config.name);

    // Get model info from aimodels - it's optional now
    const modelInfo = models.id(config.name);
    this.modelInfo = modelInfo; // can be undefined
    this._config = config;
  }

  async ask(
    prompt: string,
    onResult?: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString> {
    const messages: LangChatMessages = [];

    if (this._config.systemPrompt) {
      messages.push({
        role: "system",
        content: this._config.systemPrompt,
      });
    }

    messages.push({
      role: "user",
      content: prompt,
    });

    return await this.chat(messages, onResult);
  }

  protected transformMessages(messages: LangChatMessages): LangChatMessages {
    // By default, no transformation
    return messages;
  }

  // Rough estimate: 1 token ≈ 4 chars for English text
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  protected calculateMaxTokens(
    messages: LangChatMessages,
    modelContextTotal: number,
    modelMaxOutput: number
  ): number {
    // If we don't have model info, use conservative defaults
    const contextWindow = this.modelInfo?.context?.total || 4000;
    const maxOutput = this.modelInfo?.context?.maxOutput || 1000;

    // Calculate estimated tokens in messages
    const estimatedInputTokens = messages.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content);
    }, 0);

    // Add some overhead for message formatting (roles, etc)
    const overhead = messages.length * 4;

    const availableTokens = contextWindow - estimatedInputTokens - overhead;

    // Use either the model's maxOutput or the available tokens, whichever is smaller
    return Math.min(
      maxOutput,
      availableTokens
    );
  }

  async chat(
    messages: LangChatMessages,
    onResult?: (result: LangResultWithMessages) => void,
  ): Promise<LangResultWithMessages> {
    const result = new LangResultWithMessages(messages);
    const transformedMessages = this.transformMessages(messages);

    // Calculate max tokens for the request, using model info if available
    const requestMaxTokens = this.modelInfo 
      ? calculateModelResponseTokens(
          this.modelInfo,
          transformedMessages,
          this._config.maxTokens
        )
      : this._config.maxTokens || 4000; // Default if no model info or maxTokens

    const onData = (data: any) => {
      if (data.finished) {
        result.finished = true;
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

    const response = await fetch(`${this._config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._config.apiKey}`,
        ...this._config.headers,
      },
      body: JSON.stringify({
        model: this._config.name,
        messages: transformedMessages,
        stream: true,
        max_tokens: requestMaxTokens,
      }),
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