import {
  LangChatMessageCollection,
  LangChatMessage,
  LangOptions,
  LangResult,
  LanguageProvider,
  ToolRequest,
  Tool,
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
    options?: LangOptions,
  ): Promise<LangResult> {
    const messages = new LangChatMessageCollection();
    if (this._config.systemPrompt) {
      messages.push({
        role: "user" as "user",
        content: this._config.systemPrompt,
      });
    }

    messages.push({
      role: "user",
      content: prompt,
    });

    return await this.chat(messages, options);
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
   * Checks if the current model has reasoning capabilities
   * @returns True if the model supports reasoning, false otherwise
   */
  supportsReasoning(): boolean {
    if (this.modelInfo) {
      return this.modelInfo.canReason();
    }
    
    return false;
  }

  async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult> {
    // Ensure we have a LangChatMessageCollection
    let messageCollection: LangChatMessageCollection;
    if (messages instanceof LangChatMessageCollection) {
      messageCollection = messages;
    } else {
      messageCollection = new LangChatMessageCollection(...messages);
    }
    
    const result = new LangResult(messageCollection);
    const onResult = options?.onResult;

    // Calculate max tokens for the request, using model info if available
    const requestMaxTokens = this.modelInfo 
      ? calculateModelResponseTokens(
          this.modelInfo,
          messages,
          this._config.maxTokens
        )
      : this._config.maxTokens || 4000; // Default if no model info or maxTokens
      
    // For reasoning models, ensure there's enough space for reasoning
    // if maxCompletionTokens is not explicitly set
    if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
      this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
    }

    const onData = (data: any) => {
      this.handleStreamData(data, result, messageCollection, onResult);
    };

    // Prepare request body with tools if provided
    const body = this.transformBody({
      model: this._config.model,
      messages: messageCollection,
      stream: true,
      max_tokens: requestMaxTokens,
      ...this._config.bodyProperties,
      // Add tools to the request if provided
      ...(options?.tools ? { tools: this.formatTools(options.tools) } : {}),
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
   * Formats tools for the OpenAI API request
   * @param tools Array of tools to format
   * @returns Formatted tools for the API request
   */
  protected formatTools(tools: Tool[]): any[] {
    // Simple pass-through for now, but implementations can override this
    // to format tools according to their specific API requirements
    return tools.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Handles streaming data from the API response
   * This method can be overridden by subclasses to add custom handling for different response formats
   * @param data The current data chunk from the stream
   * @param result The result object being built
   * @param messages The original messages array
   * @param onResult Optional callback for streaming results
   */
  protected handleStreamData(
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

    if (data.choices !== undefined) {
      const delta = data.choices[0].delta;
      
      // Handle regular text content
      if (delta.content) {
        result.answer += delta.content;
      }
      
      // Handle tool calls if present in the delta
      if (delta.tool_calls) {
        // Initialize tools array if it doesn't exist
        if (!result.tools) {
          result.tools = [];
        }
        
        // Process each tool call
        for (const toolCall of delta.tool_calls) {
          // For streaming, we need to handle partial tool calls
          // This is a stub implementation that will be expanded later
          const existingToolCall = result.tools.find(t => t.id === toolCall.id);
          
          if (existingToolCall) {
            // Update existing tool call
            if (toolCall.function?.name) {
              existingToolCall.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              // In a real implementation, we would need to handle partial JSON
              // For now, just append the arguments string
              existingToolCall.arguments = {
                ...existingToolCall.arguments,
                ...JSON.parse(toolCall.function.arguments)
              };
            }
          } else if (toolCall.id) {
            // Add new tool call
            result.tools.push({
              id: toolCall.id,
              name: toolCall.function?.name || '',
              arguments: toolCall.function?.arguments ? 
                JSON.parse(toolCall.function.arguments) : {}
            });
          }
        }
      }

      // Update the messages array with the latest content
      if (result.messages.length > 0 && 
          result.messages[result.messages.length - 1].role === "assistant") {
        // Update the existing assistant message
        result.messages[result.messages.length - 1].content = result.answer;
      } else {
        // Add a new assistant message
        result.messages.push({
          role: "assistant",
          content: result.answer,
        });
      }

      onResult?.(result);
    }
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
}