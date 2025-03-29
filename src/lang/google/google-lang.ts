import {
  LangChatMessages,
  LangOptions,
  LangResultWithMessages,
  LangResultWithString,
  LanguageProvider,
  FunctionCall,
  FunctionDefinition,
} from "../language-provider.ts";
import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type GoogleLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class GoogleLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _maxTokens?: number;
  private modelInfo?: Model;

  constructor(options: GoogleLangOptions) {
    const modelName = options.model || "gemini-2.0-flash";
    super(modelName);

    // Get model info from aimodels
    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Google model: ${modelName}. Model not found in aimodels database.`);
    }

    this.modelInfo = modelInfo;
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
    this._maxTokens = options.maxTokens;
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

    if (this._systemPrompt) {
      messages.push({
        role: "system",
        content: this._systemPrompt,
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
   * Converts our internal function definitions to Google Gemini's format
   */
  protected convertFunctionsToGeminiFormat(functions: FunctionDefinition[]): any {
    // Convert each function into the format Gemini expects
    // The format should be:
    // [
    //   {
    //     functionDeclarations: [
    //       { name, description, parameters },
    //       ...
    //     ]
    //   }
    // ]
    return [{
      functionDeclarations: functions.map(func => ({
        name: func.name,
        description: func.description,
        parameters: {
          type: "object",
          properties: Object.entries(func.parameters).reduce((acc, [name, param]) => {
            acc[name] = {
              type: param.type,
              description: param.description
            };
            
            if (param.enum) {
              acc[name].enum = param.enum;
            }
            
            if (param.items) {
              acc[name].items = param.items;
            }
            
            return acc;
          }, {} as Record<string, any>),
          required: Object.entries(func.parameters)
            .filter(([_, param]) => param.required)
            .map(([name, _]) => name)
        }
      }))
    }];
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
      onResult = opts.onResult;
    }

    const result = new LangResultWithMessages(messages);

    // Transform messages into Google's format
    const contents = messages.map(msg => {
      if (msg.role === "system") {
        // For system messages, we'll send them as user messages with a clear prefix
        return {
          role: "user",
          parts: [{ text: `System instruction: ${msg.content}` }]
        };
      }
      
      // For function call messages from the assistant
      if (msg.role === "assistant" && msg.function_call) {
        return {
          role: "model",
          parts: [
            { text: msg.content || "" },
            { functionCall: { name: msg.function_call.name, args: JSON.parse(msg.function_call.arguments) } }
          ]
        };
      }
      
      // For function result messages
      if (msg.role === "function") {
        return {
          role: "function",
          parts: [{ functionResponse: { name: msg.name, response: { content: msg.content } } }]
        };
      }
      
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      };
    });

    // Calculate max tokens if we have model info
    let maxOutputTokens = this._maxTokens;
    if (this.modelInfo && !maxOutputTokens) {
      maxOutputTokens = calculateModelResponseTokens(
        this.modelInfo,
        messages,
        this._maxTokens
      );
    }

    const requestBody: any = {
      contents,
      generationConfig: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
      }
    };

    // Add function declarations if present in options
    if (opts.functions && opts.functions.length > 0) {
      const toolsDeclaration = this.convertFunctionsToGeminiFormat(opts.functions);
      requestBody.tools = toolsDeclaration;
      console.log("Adding function declarations to request:", JSON.stringify(toolsDeclaration, null, 2));
    }

    // Initialize function calls array
    if (!result.functionCalls) {
      result.functionCalls = [];
    }

    const onData = (data: any) => {
      if (data.finished) {
        result.finished = true;
        onResult?.(result);
        return;
      }

      const candidate = data.candidates?.[0];
      if (!candidate) return;

      // Handle Google's streaming format
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          // Check for normal text content
          if (part.text) {
            result.answer += part.text;
  
            result.messages = [...messages, {
              role: "assistant",
              content: result.answer,
            }];
          }
          
          // Check for function call
          if (part.functionCall) {
            console.log("Function call detected:", JSON.stringify(part.functionCall, null, 2));
            
            // Ensure arguments are properly formatted
            const args = part.functionCall.args || {};
            const rawArgs = JSON.stringify(args);
            
            // Create a function call object in our format
            const functionCall: FunctionCall = {
              id: crypto.randomUUID(), // Google doesn't provide IDs, so we generate one
              name: part.functionCall.name,
              arguments: args,
              rawArguments: rawArgs,
              provider: 'google',
              handled: false
            };
            
            // Add to our result's function calls
            if (!result.functionCalls) {
              result.functionCalls = [];
            }
            result.functionCalls.push(functionCall);
            
            // Update messages to include the function call
            result.messages = [...result.messages, {
              role: "assistant",
              content: result.answer,
              function_call: {
                name: functionCall.name,
                arguments: rawArgs // Guaranteed to be a string now
              }
            }];
          }
        }
        
        onResult?.(result);
      }
    };

    // Use proper streaming endpoint for Gemini
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:streamGenerateContent?alt=sse&key=${this._apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
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
      },
    ).catch((err) => {
      throw new Error(err);
    });

    await processResponseStream(response, onData);
    
    // Execute function calls if we have a handler
    if (result.functionCalls && result.functionCalls.length > 0 && opts.functionHandler) {
      await this.handleFunctionCalls(result, messages, opts);
    }

    return result;
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
      
      // Add function result to messages
      messages.push({
        role: "function",
        name: call.name,
        content: typeof response === 'string' ? response : JSON.stringify(response)
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