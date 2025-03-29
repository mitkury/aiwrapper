import {
  FunctionCall,
  FunctionDefinition,
  LangChatMessages,
  LangOptions,
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
    onResultOrOptions?: ((result: LangResultWithString) => void) | LangOptions,
    options?: LangOptions,
  ): Promise<LangResultWithString> {
    // Handle overloaded parameters
    let onResult: ((result: LangResultWithString) => void) | undefined;
    let opts: LangOptions = {};
    
    if (typeof onResultOrOptions === 'function') {
      onResult = onResultOrOptions;
      opts = options || {};
    } else if (onResultOrOptions) {
      opts = onResultOrOptions;
      onResult = undefined;
    }

    const messages: LangChatMessages = [];

    // Apply system prompt from options or config
    const systemPrompt = opts.systemPrompt || this._config.systemPrompt;
    if (systemPrompt) {
      messages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    messages.push({
      role: "user",
      content: prompt,
    });

    // Get the chat result
    const chatResult = await this.chat(messages, onResult, opts);
    
    // Create a result with the prompt but use data from chatResult
    const result = new LangResultWithString(prompt);
    result.answer = chatResult.answer;
    result.thinking = chatResult.thinking;
    result.finished = chatResult.finished;
    result.functionCalls = chatResult.functionCalls;
    
    return result;
  }

  protected transformMessages(messages: LangChatMessages): LangChatMessages {
    // By default, no transformation
    return messages;
  }

  /**
   * Converts our internal function definitions to OpenAI format
   * @param functions Array of function definitions
   * @returns OpenAI format tools array
   */
  protected convertFunctionsToTools(functions: FunctionDefinition[]): any[] {
    return functions.map(f => ({
      type: "function",
      function: {
        name: f.name,
        description: f.description,
        parameters: {
          type: "object",
          properties: this.convertParameters(f.parameters),
          required: this.getRequiredParameters(f.parameters),
        },
      },
    }));
  }

  /**
   * Convert parameter map to OpenAI format
   */
  protected convertParameters(parameters: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const [name, param] of Object.entries(parameters)) {
      result[name] = {
        type: param.type,
        description: param.description,
      };
      
      if (param.enum) {
        result[name].enum = param.enum;
      }
      
      if (param.items) {
        result[name].items = param.items;
      }
      
      if (param.properties) {
        result[name].properties = this.convertParameters(param.properties);
      }
    }
    
    return result;
  }

  /**
   * Extract required parameters from the parameters map
   */
  protected getRequiredParameters(parameters: Record<string, any>): string[] {
    return Object.entries(parameters)
      .filter(([_, param]) => param.required)
      .map(([name, _]) => name);
  }

  /**
   * Convert OpenAI tool calls to our standard FunctionCall format
   */
  protected convertToolCallsToFunctionCalls(toolCalls: any[]): FunctionCall[] {
    if (!toolCalls || !Array.isArray(toolCalls)) return [];
    
    return toolCalls.map(call => ({
      id: call.id,
      name: call.function.name,
      arguments: this.parseArguments(call.function.arguments),
      rawArguments: call.function.arguments,
      provider: "openai"
    }));
  }

  /**
   * Parse a function arguments string into an object
   */
  protected parseArguments(argumentsStr: string): Record<string, any> {
    try {
      return JSON.parse(argumentsStr);
    } catch (e) {
      console.error("Failed to parse function arguments:", e);
      return {};
    }
  }

  protected transformBody(body: Record<string, unknown>, options?: LangOptions): Record<string, unknown> {
    const transformedBody = { ...body };
    
    // Add reasoning_effort if specified and we're using a reasoning model
    if (this._config.reasoningEffort && this.supportsReasoning()) {
      transformedBody.reasoning_effort = this._config.reasoningEffort;
    }
    
    // Add max_completion_tokens if specified (for reasoning models)
    if (this._config.maxCompletionTokens !== undefined && this.supportsReasoning()) {
      transformedBody.max_completion_tokens = this._config.maxCompletionTokens;
    }

    // Add function calling config if specified
    if (options?.functions && options.functions.length > 0) {
      transformedBody.tools = this.convertFunctionsToTools(options.functions);
      
      // Add tool_choice if specified
      if (options.functionCall) {
        transformedBody.tool_choice = options.functionCall === 'auto' 
          ? 'auto' 
          : options.functionCall === 'none' 
            ? 'none' 
            : { type: 'function', function: { name: options.functionCall.name } };
      }
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
    messages: LangChatMessages,
    onResultOrOptions?: ((result: LangResultWithMessages) => void) | LangOptions,
    options?: LangOptions,
  ): Promise<LangResultWithMessages> {
    // Handle overloaded parameters
    let onResult: ((result: LangResultWithMessages) => void) | undefined;
    let opts: LangOptions = {};
    
    if (typeof onResultOrOptions === 'function') {
      onResult = onResultOrOptions;
      opts = options || {};
    } else if (onResultOrOptions) {
      opts = onResultOrOptions;
      onResult = undefined;
    }

    const result = new LangResultWithMessages(messages);
    const transformedMessages = this.transformMessages(messages);

    // Calculate max tokens for the request, using model info if available
    const requestMaxTokens = this.modelInfo 
      ? calculateModelResponseTokens(
          this.modelInfo,
          transformedMessages,
          opts.maxTokens || this._config.maxTokens
        )
      : opts.maxTokens || this._config.maxTokens || 4000; // Default if no model info or maxTokens
      
    // For reasoning models, ensure there's enough space for reasoning
    // if maxCompletionTokens is not explicitly set
    if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
      this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
    }

    const onData = (data: any) => {
      this.handleStreamData(data, result, messages, onResult, opts);
    };

    const body = this.transformBody({
      model: this._config.model,
      messages: transformedMessages,
      stream: true,
      max_tokens: requestMaxTokens,
      ...this._config.bodyProperties,
    }, opts);

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
   * Handles streaming data from the API response
   * This method can be overridden by subclasses to add custom handling for different response formats
   * @param data The current data chunk from the stream
   * @param result The result object being built
   * @param messages The original messages array
   * @param onResult Optional callback for streaming results
   * @param options Options passed to the API request
   */
  protected async handleStreamData(
    data: any, 
    result: LangResultWithMessages,
    messages: LangChatMessages,
    onResult?: (result: LangResultWithMessages) => void,
    options?: LangOptions
  ): Promise<void> {
    // Initialize function call collection if needed
    if (!result.functionCalls) {
      result.functionCalls = [];
    }
    
    if (data.finished) {
      result.finished = true;
      
      // When streaming is finished, check if we have any function calls to process
      if (result.functionCalls && result.functionCalls.length > 0 && options?.functionHandler) {
        // Try to ensure arguments are properly parsed for all function calls
        for (const call of result.functionCalls) {
          if (call.rawArguments && (!call.arguments || Object.keys(call.arguments).length === 0)) {
            try {
              call.arguments = JSON.parse(call.rawArguments);
            } catch (e) {
              console.warn(`Failed to parse arguments for function ${call.name}:`, e);
              call.arguments = {};
            }
          }
        }
        
        // Process valid function calls
        await this.handleFunctionCalls(result, messages, options);
      }
      
      onResult?.(result);
      return;
    }

    if (data.choices !== undefined) {
      const choice = data.choices[0];
      const delta = choice.delta;

      // Handle text content
      if (delta.content) {
        result.answer += delta.content;

        result.messages = [...messages, {
          role: "assistant",
          content: result.answer,
        }];

        onResult?.(result);
      }
      
      // Process function/tool calls in streaming response
      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const toolCallDelta of delta.tool_calls) {
          // Skip if no index is provided
          if (typeof toolCallDelta.index !== 'number') continue;
          
          const index = toolCallDelta.index;
          
          // Find existing function call or create a new one
          let functionCall = result.functionCalls.find(fc => fc.index === index);
          
          if (!functionCall) {
            // This is a new function call
            functionCall = {
              index,
              id: toolCallDelta.id,
              name: toolCallDelta.function?.name || '',
              arguments: {},
              rawArguments: '',
              provider: "openai"
            };
            result.functionCalls.push(functionCall);
          }
          
          // Update function call with new delta information
          if (toolCallDelta.id && !functionCall.id) {
            functionCall.id = toolCallDelta.id;
          }
          
          if (toolCallDelta.function) {
            // Update function name if present
            if (toolCallDelta.function.name) {
              functionCall.name = toolCallDelta.function.name;
            }
            
            // Accumulate arguments string
            if (toolCallDelta.function.arguments) {
              functionCall.rawArguments = (functionCall.rawArguments || '') + toolCallDelta.function.arguments;
              
              // Try to parse arguments, but don't worry if it fails (might be incomplete)
              try {
                functionCall.arguments = JSON.parse(functionCall.rawArguments);
              } catch (e) {
                // Arguments are incomplete, will try again when we get more chunks
              }
            }
          }
        }
        
        // Call the streaming callback with updated result
        onResult?.(result);
      }
    }
  }

  /**
   * Process function calls and execute the handler
   */
  protected async handleFunctionCalls(
    result: LangResultWithMessages, 
    messages: LangChatMessages,
    options: LangOptions
  ): Promise<void> {
    // Early return if we don't have the necessary data
    if (!result.functionCalls) return;
    if (!options.functionHandler) return;

    // Get all function calls that haven't been handled yet
    const pendingCalls = result.functionCalls.filter(call => !call.handled && call.name);
    
    if (pendingCalls.length === 0) return;
    
    // Process all function calls in parallel
    const functionPromises = pendingCalls.map(async (call) => {
      // Mark as handled to prevent duplicate processing
      call.handled = true;
      
      // Call the user-provided handler - we know it exists due to the early return check
      const handler = options.functionHandler!;
      try {
        const response = await handler(call);
        return { call, response };
      } catch (error) {
        console.error(`Error executing function ${call.name}:`, error);
        return { 
          call, 
          response: { error: `Error executing function: ${error instanceof Error ? error.message : String(error)}` } 
        };
      }
    });
    
    // Wait for all function calls to complete
    const results = await Promise.all(functionPromises);
    
    // Add each function result to the messages
    for (const { call, response } of results) {
      // Skip calls with empty function names
      if (!call.name) {
        console.warn("Skipping function call with empty name:", call);
        continue;
      }
      
      // Add assistant message with tool_calls
      messages.push({
        role: "assistant",
        content: "",  // Use empty string instead of null
        tool_calls: [{
          id: call.id!,  // OpenAI always provides an ID
          type: "function",
          function: {
            name: call.name,
            arguments: typeof call.rawArguments === 'string' 
              ? call.rawArguments 
              : JSON.stringify(call.arguments)
          }
        }]
      });
      
      // Add tool message with the response
      messages.push({
        role: "tool",
        tool_call_id: call.id!,  // OpenAI always provides an ID
        content: typeof response === 'string' 
          ? response 
          : JSON.stringify(response)
      });
    }
    
    // Continue the conversation with the function results
    await this.chat(messages, (updatedResult) => {
      // Update our result with the new response
      result.answer = updatedResult.answer;
      result.messages = updatedResult.messages;
      
      // Append any new function calls
      if (updatedResult.functionCalls && result.functionCalls) {
        for (const newCall of updatedResult.functionCalls) {
          if (!result.functionCalls.some(c => c.id === newCall.id)) {
            result.functionCalls.push(newCall);
          }
        }
      }
    });
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