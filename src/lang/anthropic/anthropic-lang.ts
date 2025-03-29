import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import {
  FunctionCall,
  FunctionDefinition,
  LangChatMessages,
  LangOptions,
  LangResultWithMessages,
  LangResultWithString,
  LanguageProvider,
} from "../language-provider.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type AnthropicLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  extendedThinking?: boolean;
};

export type AnthropicLangConfig = {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  extendedThinking?: boolean;
};

export class AnthropicLang extends LanguageProvider {
  _config: AnthropicLangConfig;
  // Map to store JSON accumulation for each function call across streaming events
  private jsonAccumulators = new Map<string, string>();

  constructor(options: AnthropicLangOptions) {
    const modelName = options.model || "claude-3-sonnet-20240229";
    super(modelName);

    // Get model info from aimodels
    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Anthropic model: ${modelName}. Model not found in aimodels database.`);
    }

    this._config = {
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt,
      maxTokens: options.maxTokens,
      extendedThinking: options.extendedThinking,
    };
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

    console.log("AnthropicLang.ask options:", JSON.stringify({
      hasFunctions: !!opts.functions,
      functionCount: opts.functions?.length,
      hasFunctionHandler: !!opts.functionHandler,
      functionCall: opts.functionCall,
    }, null, 2));

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

    // Create a wrapper function to convert LangResultWithMessages to LangResultWithString if needed
    const onResultWrapper = onResult ? (chatResult: LangResultWithMessages) => {
      // Create a string result from the chat result
      const stringResult = new LangResultWithString(prompt);
      stringResult.answer = chatResult.answer;
      stringResult.thinking = chatResult.thinking;
      stringResult.finished = chatResult.finished;
      stringResult.functionCalls = chatResult.functionCalls;
      
      // Call the original callback
      onResult(stringResult);
    } : undefined;
    
    // Call chat directly with our options
    let chatOpts: LangOptions = { ...opts };
    if (onResultWrapper) {
      // If we have a result handler, remove onResult from options and handle it separately
      delete chatOpts.onResult;
      const chatResult = await this.chat(messages, onResultWrapper, chatOpts);
      
      // Create a result with the prompt but use data from chatResult
      const result = new LangResultWithString(prompt);
      result.answer = chatResult.answer;
      result.thinking = chatResult.thinking;
      result.finished = chatResult.finished;
      result.functionCalls = chatResult.functionCalls;
      
      return result;
    } else {
      // No result handler, just pass options directly to chat
      const chatResult = await this.chat(messages, chatOpts);
      
      // Create a result with the prompt but use data from chatResult
      const result = new LangResultWithString(prompt);
      result.answer = chatResult.answer;
      result.thinking = chatResult.thinking;
      result.finished = chatResult.finished;
      result.functionCalls = chatResult.functionCalls;
      
      return result;
    }
  }

  /**
   * Converts our internal function definitions to Anthropic format
   * @param functions Array of function definitions
   * @returns Anthropic format tools array
   */
  protected convertFunctionsToTools(functions: FunctionDefinition[]): any[] {
    return functions.map(f => ({
      name: f.name,
      description: f.description,
      input_schema: {
        type: "object",
        properties: this.convertParameters(f.parameters),
        required: this.getRequiredParameters(f.parameters),
      }
    }));
  }

  /**
   * Convert parameter map to Anthropic format
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
   * Parse a function arguments JSON
   */
  protected parseArguments(args: Record<string, any>): Record<string, any> {
    try {
      return typeof args === 'string' ? JSON.parse(args) : args;
    } catch (e) {
      console.error("Failed to parse function arguments:", e);
      return {};
    }
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
    
    // Debug: Log the options we received
    console.log("AnthropicLang.chat options:", JSON.stringify({
      hasFunctions: !!opts.functions,
      functionCount: opts.functions?.length,
      hasFunctionHandler: !!opts.functionHandler,
      functionCall: opts.functionCall,
    }, null, 2));
    
    // Remove all system messages, save the first one if it exists.
    let detectedSystemMessage = "";
    messages = messages.filter((message) => {
      if (message.role === "system") {
        if (!detectedSystemMessage) {
          // Saving the first system message.
          detectedSystemMessage = message.content;
        }
        return false;
      }
      return true;
    });

    const result = new LangResultWithMessages(messages);

    // Get model info and calculate max tokens
    const modelInfo = models.id(this._config.model);
    if (!modelInfo) {
      throw new Error(`Model info not found for ${this._config.model}`);
    }

    const requestMaxTokens = calculateModelResponseTokens(
      modelInfo,
      messages,
      this._config.maxTokens
    );

    // Track if we're receiving thinking content
    let isReceivingThinking = false;
    let thinkingContent = "";

    const onData = (data: any) => {
      this.handleStreamData(data, result, messages, thinkingContent, isReceivingThinking, onResult, opts);
    };

    // Check if the model supports extended thinking by looking for the "reason" capability
    const supportsExtendedThinking = modelInfo.can && modelInfo.can("reason");
    
    // Prepare request body
    const requestBody: any = {
      model: this._config.model,
      messages: messages,
      max_tokens: requestMaxTokens,
      system: this._config.systemPrompt ? this._config.systemPrompt : detectedSystemMessage,
      stream: true,
    };

    // Add tools if specified
    if (opts.functions && opts.functions.length > 0) {
      // Convert our functions to Anthropic tools format
      requestBody.tools = this.convertFunctionsToTools(opts.functions);
      console.log("Adding tools to request:", JSON.stringify(requestBody.tools, null, 2));
    }

    // Add extended thinking if enabled and supported
    if (this._config.extendedThinking && supportsExtendedThinking) {
      // Calculate a reasonable thinking budget
      // According to Anthropic's docs, max_tokens must be greater than thinking.budget_tokens
      // So we'll set thinking budget to be 75% of max_tokens
      let thinkingBudget = Math.floor(requestMaxTokens * 0.75);
      
      // Check if the model has extended reasoning info
      // Using type assertion to avoid TypeScript errors since the aimodels types might not include the extended property
      const contextObj = modelInfo.context as any;
      if (contextObj && contextObj.extended && contextObj.extended.reasoning && contextObj.extended.reasoning.maxOutput) {
        // Make sure thinking budget doesn't exceed the model's capabilities
        thinkingBudget = Math.min(
          thinkingBudget,
          Math.floor(contextObj.extended.reasoning.maxOutput * 0.75)
        );
      }
      
      // Make sure thinking budget is at least 1000 tokens for meaningful reasoning
      thinkingBudget = Math.max(thinkingBudget, 1000);
      
      // Ensure max_tokens is greater than thinking.budget_tokens
      requestBody.max_tokens = Math.max(requestMaxTokens, thinkingBudget + 1000);
      
      // According to the Anthropic API, we need to use 'enabled' as the type
      requestBody.thinking = {
        type: "enabled",
        budget_tokens: thinkingBudget
      };
    }

    // Prepare headers - always include the tools beta header if we have functions
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": this._config.apiKey
    };
    
    // Add the tools beta header if needed
    if (opts.functions && opts.functions.length > 0) {
      headers["anthropic-beta"] = "tools-2024-04-04"; // Required for tools beta
      console.log("Adding tools beta header");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      onNotOkResponse: async (
        res,
        decision,
      ): Promise<DecisionOnNotOkResponse> => {
        if (res.status === 401) {
          // We don't retry if the API key is invalid.
          decision.retry = false;
          throw new Error(
            "API key is invalid. Please check your API key and try again.",
          );
        }

        if (res.status === 400) {
          const data = await res.text();

          // We don't retry if the model is invalid.
          decision.retry = false;
          throw new Error(
            data,
          );
        }

        return decision;
      },
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);

    return result;
  }

  /**
   * Handles streaming data from the API response
   * This method can be overridden by subclasses to add custom handling for different response formats
   * 
   * Function Calling Flow for Anthropic:
   * 1. During streaming, we detect 'tool_use' type blocks and collect them
   * 2. When a full block is received, we convert it to our FunctionCall format
   * 3. When streaming is complete, we execute the functions and continue the conversation
   * 
   * @param data The current data chunk from the stream
   * @param result The result object being built
   * @param messages The original messages array
   * @param thinkingContent Content from thinking mode
   * @param isReceivingThinking Whether we're currently receiving thinking content
   * @param onResult Optional callback for streaming results
   * @param options Options passed to the API request
   */
  protected async handleStreamData(
    data: any,
    result: LangResultWithMessages,
    messages: LangChatMessages,
    thinkingContent: string,
    isReceivingThinking: boolean,
    onResult?: (result: LangResultWithMessages) => void,
    options?: LangOptions
  ): Promise<void> {
    if (!result.functionCalls) {
      result.functionCalls = [];
    }
    
    try {
      if (data.type === 'message_start') {
        console.log('ANTHROPIC EVENT: message_start');
      } else if (data.type === 'content_block_start') {
        console.log(`ANTHROPIC EVENT: content_block_start content_block.type: ${data.content_block.type}`);
        
        if (data.content_block.type === 'tool_use') {
          console.log('TOOL USE START:', JSON.stringify(data.content_block, null, 2));
          const toolUse = data.content_block;
          
          // Create a new function call
          const functionCall: FunctionCall = {
            id: toolUse.id,
            index: data.index !== undefined ? parseInt(String(data.index)) : undefined,
            name: toolUse.name,
            arguments: {},
            rawArguments: '{}',
            provider: 'anthropic',
            handled: false
          };
          
          result.functionCalls.push(functionCall);
          // Initialize accumulator for this function call
          this.jsonAccumulators.set(toolUse.id, '');
        }
      } else if (data.type === 'content_block_delta' && data.delta.type === 'tool_use') {
        const delta = data.delta;
        
        // Find the function call in the result
        if (data.index !== undefined && result.functionCalls && result.functionCalls.length > 0) {
          // We always work with the last function call since Anthropic streams them one by one
          const functionCall = result.functionCalls[result.functionCalls.length - 1];
          
          if (delta.input !== undefined && functionCall.id) {
            // Get the current accumulator for this function call
            let accumulatedJson = this.jsonAccumulators.get(functionCall.id) || '';
            
            // Accumulate input JSON
            accumulatedJson += delta.input;
            this.jsonAccumulators.set(functionCall.id, accumulatedJson);
            console.log(`Accumulated partial JSON for ${functionCall.name}: ${accumulatedJson}`);
            
            // Try to parse the accumulated JSON to see if it's complete
            try {
              const parsedArgs = JSON.parse(accumulatedJson);
              functionCall.arguments = parsedArgs;
              functionCall.rawArguments = JSON.stringify(parsedArgs);
              console.log(`Successfully parsed JSON for ${functionCall.name}: ${JSON.stringify(parsedArgs, null, 2)}`);
            } catch (e) {
              // JSON is still incomplete, which is expected
            }
          }
        }
      } else if (data.type === 'content_block_delta' && data.delta.type === 'input_json_delta') {
        // This is the format shown in the example response
        const delta = data.delta;
        
        if (delta.partial_json !== undefined && data.index !== undefined && result.functionCalls && result.functionCalls.length > 0) {
          // In this case, we need to find a function call using the index as a key
          // Since this doesn't match our ID, we need to keep track separately
          
          // Create a map to associate indexes with function calls
          const functionCallByIndex = new Map<number, FunctionCall>();
          
          // Fill the map with existing function calls
          for (const call of result.functionCalls) {
            // Store by numeric index
            if (call.index !== undefined) {
              functionCallByIndex.set(call.index, call);
            }
            
            // Also map by the index from content_block_start if that's what we have
            if (call.id) {
              // The data.index could be the content block index, not the ID
              // Try to see if we can map it
              functionCallByIndex.set(parseInt(String(data.index)), call);
            }
          }
          
          // Find the function call - we prefer using the index
          const functionCall = functionCallByIndex.get(parseInt(String(data.index))) || 
                              result.functionCalls[result.functionCalls.length - 1];
          
          // If we found a function call, accumulate the JSON
          if (functionCall && functionCall.id) {
            // Make sure we have an accumulator for this call
            if (!this.jsonAccumulators.has(functionCall.id)) {
              this.jsonAccumulators.set(functionCall.id, '');
            }
            
            // Get the current accumulator for this function call
            let accumulatedJson = this.jsonAccumulators.get(functionCall.id) || '';
            
            // Accumulate input JSON
            accumulatedJson += delta.partial_json;
            this.jsonAccumulators.set(functionCall.id, accumulatedJson);
            console.log(`Accumulated partial JSON for ${functionCall.name}: ${accumulatedJson}`);
            
            // Try to parse the accumulated JSON to see if it's complete
            try {
              const parsedArgs = JSON.parse(accumulatedJson);
              functionCall.arguments = parsedArgs;
              functionCall.rawArguments = JSON.stringify(parsedArgs);
              console.log(`Successfully parsed JSON for ${functionCall.name}: ${JSON.stringify(parsedArgs, null, 2)}`);
            } catch (e) {
              // JSON is still incomplete, which is expected
            }
          } else {
            console.log(`Could not find function call for index ${data.index}`);
          }
        }
      } else if (data.type === 'content_block_stop') {
        console.log('ANTHROPIC EVENT: content_block_stop');
        
        // Check if we have any function calls
        if (result.functionCalls && result.functionCalls.length > 0) {
          // Get the last function call
          const functionCall = result.functionCalls[result.functionCalls.length - 1];
          
          // Make sure we've parsed the JSON correctly
          if (functionCall.id && Object.keys(functionCall.arguments).length === 0) {
            const accumulatedJson = this.jsonAccumulators.get(functionCall.id);
            if (accumulatedJson) {
              try {
                const parsedArgs = JSON.parse(accumulatedJson);
                functionCall.arguments = parsedArgs;
                functionCall.rawArguments = JSON.stringify(parsedArgs);
                console.log(`Parsed final JSON for ${functionCall.name}: ${JSON.stringify(parsedArgs, null, 2)}`);
              } catch (e) {
                console.warn(`Failed to parse final JSON for ${functionCall.name}: ${accumulatedJson}`);
              }
            }
          }
        }
      } else if (data.type === 'message_delta') {
        console.log('ANTHROPIC EVENT: message_delta');
      } else if (data.type === 'message_stop') {
        console.log('ANTHROPIC EVENT: message_stop');
      } else if (data.type === 'ping') {
        console.log('ANTHROPIC EVENT: ping');
      }
    } catch (e) {
      console.error('Error parsing Anthropic event:', e);
    }

    if (data.type === "message_stop") {
      // Store the thinking content in the result object before finishing
      result.thinking = thinkingContent;
      result.finished = true;
      
      // Try to finalize any function calls by reconstructing from accumulated partial JSON
      for (const call of result.functionCalls) {
        if (call.id && Object.keys(call.arguments).length === 0) {
          const accumulatedJson = this.jsonAccumulators.get(call.id);
          if (accumulatedJson) {
            try {
              // One last attempt to parse the JSON
              const parsedArgs = JSON.parse(accumulatedJson);
              call.arguments = parsedArgs;
              call.rawArguments = JSON.stringify(parsedArgs);
              console.log(`Parsed final JSON for ${call.name}:`, JSON.stringify(call.arguments, null, 2));
            } catch (e) {
              console.error(`Failed to parse final JSON for ${call.name}:`, accumulatedJson);
            }
          }
        }
      }
      
      // Also check if there are any function calls in the message
      if (data.message && data.message.content) {
        for (const contentBlock of data.message.content) {
          if (contentBlock.type === 'tool_use') {
            // Check if we already have this function call
            let existingCall = result.functionCalls.find(call => call.id === contentBlock.id);
            
            if (!existingCall) {
              // Create a new function call
              const functionCall: FunctionCall = {
                id: contentBlock.id,
                name: contentBlock.name,
                arguments: contentBlock.input || {},
                rawArguments: JSON.stringify(contentBlock.input || {}),
                provider: 'anthropic',
                handled: false
              };
              
              result.functionCalls.push(functionCall);
              console.log(`Added function call from final message: ${functionCall.name}`);
            } else {
              // Update existing call with complete data
              existingCall.arguments = contentBlock.input || {};
              existingCall.rawArguments = JSON.stringify(contentBlock.input || {});
              console.log(`Updated function call from final message: ${existingCall.name}`);
            }
          }
        }
      }
      
      // Clear the accumulators after we're done
      this.jsonAccumulators.clear();
      
      // When streaming is finished, check if we have any function calls to process
      if (result.functionCalls && result.functionCalls.length > 0 && options?.functionHandler) {
        await this.handleFunctionCalls(result, messages, options);
      }
      
      onResult?.(result);
      return;
    }

    // Handle thinking content
    if (data.type === "content_block_start" && data.content_block?.type === "thinking") {
      isReceivingThinking = true;
      return;
    }

    if (data.type === "content_block_stop" && isReceivingThinking) {
      isReceivingThinking = false;
      // Update the thinking content in the result object
      result.thinking = thinkingContent;
      onResult?.(result);
      return;
    }
    
    // Handle regular tool_use_delta events
    if (data.type === "content_block_delta" && data.delta.type === "tool_use_delta") {
      if (data.delta.input && data.index) {
        // Find the function call with matching id or index
        const functionCall = result.functionCalls.find(fc => 
          (fc.id === data.index) || (fc.index === data.index));
          
        if (functionCall) {
          // For Anthropic, input is already a parsed object, not a string
          functionCall.arguments = data.delta.input;
          functionCall.rawArguments = JSON.stringify(data.delta.input);
          console.log("Updated function call arguments:", JSON.stringify(functionCall.arguments, null, 2));
          onResult?.(result);
        }
      }
      return;
    }
    
    // Handle complete content blocks
    if (data.type === "content_block" && data.content_block?.type === "tool_use") {
      const toolBlock = data.content_block;
      
      // Find if we already have this function call
      let functionCall = result.functionCalls.find(fc => fc.id === toolBlock.id);
      
      if (!functionCall) {
        // Create a new function call if we don't have it yet
        functionCall = {
          id: toolBlock.id,
          name: toolBlock.name,
          arguments: toolBlock.input || {},
          rawArguments: JSON.stringify(toolBlock.input || {}),
          provider: "anthropic"
        };
        result.functionCalls.push(functionCall);
        console.log("Created new function call from complete block:", functionCall.name);
      } else {
        // Update existing function call with complete input
        functionCall.arguments = toolBlock.input || {};
        functionCall.rawArguments = JSON.stringify(toolBlock.input || {});
        console.log("Updated function call from complete block:", functionCall.name);
      }
      
      onResult?.(result);
      return;
    }

    if (
      data.type === "message_delta" && data.delta.stop_reason === "end_turn"
    ) {
      const choices = data.delta.choices;
      if (choices && choices.length > 0) {
        const deltaContent = choices[0].delta.content
          ? choices[0].delta.content
          : "";
        result.answer += deltaContent;
        result.messages = [
          ...messages,
          {
            role: "assistant",
            content: result.answer,
          },
        ];
        onResult?.(result);
      }
    }

    if (data.type === "content_block_delta") {
      // Handle thinking content delta
      if (data.delta.type === "thinking_delta" && data.delta.thinking) {
        thinkingContent += data.delta.thinking;
        // Update the thinking content in the result object
        result.thinking = thinkingContent;
        onResult?.(result);
        return;
      }
      
      // Handle regular text delta
      const deltaContent = data.delta.text ? data.delta.text : "";
      
      // If we're receiving thinking content, store it separately
      if (isReceivingThinking) {
        thinkingContent += deltaContent;
        // Update the thinking content in the result object
        result.thinking = thinkingContent;
        onResult?.(result);
        return;
      }
      
      result.answer += deltaContent;
      onResult?.(result);
    }
  }
  
  /**
   * Process function calls and execute the handler
   * 
   * Once all function call information has been collected during streaming,
   * this method:
   * 1. Finds all unhandled function calls and marks them as handled
   * 2. Executes each function through the user-provided handler
   * 3. Captures the results and adds them to the message history
   * 4. Continues the conversation with these results
   * 
   * All function calls are processed in parallel for efficiency.
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
      
      // For Anthropic, we need to add both the tool call and user message with the result
      messages.push({
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: call.id || crypto.randomUUID(),
            name: call.name,
            input: call.arguments
          }
        ] as any // Type assertion to avoid TS error
      });
      
      // Add tool result
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: call.id || crypto.randomUUID(),
            content: typeof response === 'string' ? response : JSON.stringify(response)
          }
        ] as any // Type assertion to avoid TS error
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
}
