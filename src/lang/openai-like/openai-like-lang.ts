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

export type ReasoningEffort = "low" | "medium" | "high";

export type OpenAILikeConfig = {
  apiKey?: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  maxCompletionTokens?: number;
  baseURL: string;
  headers?: Record<string, string>;
  bodyProperties?: Record<string, unknown>;
  reasoningEffort?: ReasoningEffort;
};

export type ReasoningTokenDetails = {
  reasoningTokens?: number;
  audioTokens?: number;
  acceptedPredictionTokens?: number;
  rejectedPredictionTokens?: number;
};

export type TokenUsageDetails = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTokensDetails?: {
    cachedTokens?: number;
    audioTokens?: number;
  };
  completionTokensDetails?: ReasoningTokenDetails;
};

export class OpenAILikeLang extends LanguageProvider {
  protected _config: OpenAILikeConfig;
  protected modelInfo?: Model;
  protected tokenUsage?: TokenUsageDetails;

  constructor(config: OpenAILikeConfig) {
    super(config.model);

    // Get model info from aimodels - it's optional now
    const modelInfo = models.id(config.model);
    this.modelInfo = modelInfo; // can be undefined
    this._config = config;
  }

  /**
   * Creates an instance of OpenAILikeLang for custom OpenAI-compatible APIs
   * @param options Configuration options for the custom API
   * @returns A new OpenAILikeLang instance
   */
  static custom(options: {
    apiKey?: string;
    model: string;
    baseURL: string;
    systemPrompt?: string;
    maxTokens?: number;
    maxCompletionTokens?: number;
    headers?: Record<string, string>;
    bodyProperties?: Record<string, unknown>;
    reasoningEffort?: ReasoningEffort;
  }): OpenAILikeLang {
    return new OpenAILikeLang({
      apiKey: options.apiKey,
      model: options.model,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      maxCompletionTokens: options.maxCompletionTokens,
      baseURL: options.baseURL,
      headers: options.headers,
      bodyProperties: options.bodyProperties,
      reasoningEffort: options.reasoningEffort,
    });
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

  protected transformBody(body: Record<string, unknown>): Record<string, unknown> {
    const transformedBody = { ...body };
    
    // Add reasoning_effort if specified and we're using a reasoning model
    if (this._config.reasoningEffort && this.supportsReasoning()) {
      transformedBody.reasoning_effort = this._config.reasoningEffort;
    }
    
    // Add max_completion_tokens if specified (for reasoning models)
    if (this._config.maxCompletionTokens !== undefined && this.supportsReasoning()) {
      transformedBody.max_completion_tokens = this._config.maxCompletionTokens;
    }
    
    return transformedBody;
  }

  /**
   * Gets the token usage details for the last request
   * @returns The token usage details or undefined if not available
   */
  getTokenUsage(): TokenUsageDetails | undefined {
    return this.tokenUsage;
  }

  /**
   * Gets the reasoning tokens used in the last request
   * @returns The number of reasoning tokens or undefined if not available
   */
  getReasoningTokens(): number | undefined {
    return this.tokenUsage?.completionTokensDetails?.reasoningTokens;
  }

  /**
   * Checks if the current model has reasoning capabilities
   * @returns True if the model supports reasoning, false otherwise
   */
  supportsReasoning(): boolean {
    // First check using models library if available
    if (this.modelInfo && typeof this.modelInfo.canReason === 'function') {
      return this.modelInfo.canReason();
    }
    
    // Fallback to regex pattern for known OpenAI reasoning models
    return /^o[1-9](-mini|-pro)?$/.test(this._config.model);
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
      
    // For reasoning models, ensure there's enough space for reasoning
    // if maxCompletionTokens is not explicitly set
    if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
      this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
    }

    const onData = (data: any) => {
      if (data.finished) {
        result.finished = true;
        
        // Store token usage if available
        if (data.usage) {
          this.tokenUsage = {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            promptTokensDetails: data.usage.prompt_tokens_details,
            completionTokensDetails: data.usage.completion_tokens_details,
          };
          
          // If reasoning tokens were used, store them in the result
          if (this.tokenUsage?.completionTokensDetails?.reasoningTokens) {
            // For OpenAI, we don't get the actual reasoning content, just the token count
            result.thinking = `[Model used ${this.tokenUsage.completionTokensDetails.reasoningTokens} reasoning tokens]`;
          }
        }
        
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
      ...this._config.bodyProperties,
    });

    const response = await fetch(`${this._config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this._config.apiKey ? { "Authorization": `Bearer ${this._config.apiKey}` } : {}),
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
            "Authentication failed. Please check your credentials and try again.",
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

  /**
   * Sets the reasoning effort level for the model
   * @param effort The reasoning effort level: "low", "medium", or "high"
   * @returns this instance for method chaining
   */
  setReasoningEffort(effort: ReasoningEffort): OpenAILikeLang {
    this._config.reasoningEffort = effort;
    return this;
  }

  /**
   * Gets the current reasoning effort level
   * @returns The current reasoning effort level or undefined if not set
   */
  getReasoningEffort(): ReasoningEffort | undefined {
    return this._config.reasoningEffort;
  }

  /**
   * Sets the maximum number of tokens (including reasoning tokens) that can be generated
   * This is specific to reasoning models and controls the total token output
   * @param maxTokens The maximum number of tokens to generate
   * @returns this instance for method chaining
   */
  setMaxCompletionTokens(maxTokens: number): OpenAILikeLang {
    this._config.maxCompletionTokens = maxTokens;
    return this;
  }

  /**
   * Gets the current maximum completion tokens setting
   * @returns The current maximum completion tokens or undefined if not set
   */
  getMaxCompletionTokens(): number | undefined {
    return this._config.maxCompletionTokens;
  }

  /**
   * Checks if the most recent response used reasoning
   * @returns True if reasoning tokens were used in the last request, false otherwise
   */
  usedReasoning(): boolean {
    const reasoningTokens = this.getReasoningTokens();
    return reasoningTokens !== undefined && reasoningTokens > 0;
  }
} 