import {
  LangChatMessageCollection,
  LangChatMessage,
  LangOptions,
  LangResult,
  LanguageProvider,
  ToolRequest,
  Tool,
  LangContentPart,
  LangImageInput,
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
 
     // Token calculation
     const requestMaxTokens = this.modelInfo 
       ? calculateModelResponseTokens(
           this.modelInfo,
           messages,
           this._config.maxTokens
         )
       : this._config.maxTokens || 4000; // Default if no model info or maxTokens
       
     if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
       this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
     }

    // Local accumulator for streaming tool arguments
    const toolArgBuffers = new Map<string, { name: string; buffer: string }>();

    const onData = (data: any) => {
      this.handleStreamData(data, result, messageCollection, onResult, toolArgBuffers);
    };

    // Prepare provider-formatted messages (including tool result mapping)
    const providerMessages = this.transformMessagesForProvider(messageCollection);

    const isStreaming = typeof onResult === 'function';

    // Prepare request body with tools and structured output if requested
    const body = this.transformBody({
      model: this._config.model,
      messages: providerMessages,
      ...(isStreaming ? { stream: true } : {}),
      max_tokens: requestMaxTokens,
      ...this._config.bodyProperties,
      ...(options?.tools ? { tools: this.formatTools(options.tools) } : {}),
      ...(options?.schema ? { response_format: { type: 'json_object' } } : {}),
    });
 
    const commonRequest = {
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
    } as const;

    // Streaming path
    if (isStreaming) {
      const response = await fetch(`${this._config.baseURL}/chat/completions`, commonRequest as any).catch((err) => {
        throw new Error(err);
      });

      await processResponseStream(response, onData);

      // Finalize tool arguments in case the stream finished without parsing final buffers
      if ((result as any)._hasPendingToolArgs && toolArgBuffers.size > 0) {
        for (const [id, acc] of toolArgBuffers) {
          const entry = result.tools?.find(t => t.id === id);
          if (!entry) continue;
          try {
            entry.arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
          } catch {
            // Leave as last successfully parsed state
          }
        }
      }

      return result;
    }

    // Non-streaming path
    const response = await fetch(`${this._config.baseURL}/chat/completions`, commonRequest as any).catch((err) => {
      throw new Error(err);
    });

    const data: any = await response.json();
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    let accumulated = '';

    // Handle content which may be a string or array of parts
    if (typeof msg?.content === 'string') {
      accumulated = msg.content;
    } else if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') {
          accumulated += part;
        } else if (part?.type === 'text' && typeof part.text === 'string') {
          accumulated += part.text;
        } else if (part?.type === 'image_url' && part.image_url?.url) {
          result.images = result.images || [];
          result.images.push({ url: part.image_url.url, provider: this.name, model: this._config.model });
        } else if ((part?.type === 'output_image' || part?.type === 'inline_data') && (part.b64_json || part.data)) {
          const base64 = part.b64_json || part.data;
          const mimeType = part.mime_type || part.mimeType || 'image/png';
          result.images = result.images || [];
          result.images.push({ base64, mimeType, provider: this.name, model: this._config.model });
        }
      }
    }

    if (accumulated) {
      result.answer = accumulated;
      result.addAssistantMessage(result.answer);
    }

    result.finished = true;
    return result;
   }

  /**
   * Formats tools for the OpenAI API request
   */
  protected formatTools(tools: Tool[]): any[] {
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
   * Transform generic messages into provider-specific format.
   * - Maps generic tool result messages (role: "tool", content: ToolResult[]) into
   *   an array of OpenAI-compatible tool messages with tool_call_id and string content.
   */
  protected transformMessagesForProvider(messages: LangChatMessage[] | LangChatMessageCollection): any[] {
    const arr = messages instanceof Array ? messages : [...messages];
    const out: any[] = [];
    for (const msg of arr) {
      if (msg.role === "tool") {
        const contentAny = msg.content as any;
        if (Array.isArray(contentAny)) {
          for (const tr of contentAny) {
            out.push({
              role: "tool",
              tool_call_id: tr.toolId,
              content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
            });
          }
          continue;
        }
      }
      // Support structured content parts (text + images)
      const content = (msg as any).content;
      if (Array.isArray(content)) {
        const parts = this.mapContentPartsToOpenAI(content as LangContentPart[]);
        out.push({ role: msg.role, content: parts });
        continue;
      }
      out.push(msg);
    }
    return out;
  }

  private mapContentPartsToOpenAI(parts: LangContentPart[]): any[] {
    const out: any[] = [];
    for (const part of parts) {
      if (part.type === "text") {
        out.push({ type: "text", text: part.text });
      } else if (part.type === "image") {
        const mapped = this.mapImageInputToOpenAI(part.image);
        out.push(mapped);
      }
    }
    return out;
  }

  private mapImageInputToOpenAI(image: LangImageInput): any {
    // Prefer image_url mapping for OpenAI-like chat/completions
    if ((image as any).kind === "url") {
      const url = (image as any).url as string;
      return { type: "image_url", image_url: { url } };
    }
    if ((image as any).kind === "base64") {
      const base64 = (image as any).base64 as string;
      const mimeType = (image as any).mimeType || "image/png";
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return { type: "image_url", image_url: { url: dataUrl } };
    }
    if ((image as any).kind === "bytes") {
      throw new Error("LangImageInput kind 'bytes' is not supported in OpenAI-like adapter yet. Please provide base64 or URL.");
    }
    if ((image as any).kind === "blob") {
      throw new Error("LangImageInput kind 'blob' is not supported in OpenAI-like adapter yet. Please provide base64 or URL.");
    }
    throw new Error("Unknown LangImageInput kind");
  }

  /**
   * Handles streaming data from the API response with safe tool_call accumulation
   */
  protected handleStreamData(
    data: any, 
    result: LangResult,
    messages: LangChatMessageCollection,
    onResult?: (result: LangResult) => void,
    toolArgBuffers?: Map<string, { name: string; buffer: string }>
  ): void {
    if (data.finished) {
      // Finalize tool arg buffers if present
      if (toolArgBuffers && toolArgBuffers.size > 0 && result.tools) {
        for (const [id, acc] of toolArgBuffers) {
          const entry = result.tools.find(t => t.id === id);
          if (!entry) continue;
          try {
            entry.arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
          } catch {
            // ignore parse errors on finish
          }
        }
      }
      (result as any)._hasPendingToolArgs = false;
      result.finished = true;
      onResult?.(result);
      return;
    }

    if (data.choices !== undefined) {
      const delta = data.choices[0].delta;
      
      if (delta.content) {
        // OpenAI-like may stream content as a string or as structured parts
        if (typeof delta.content === 'string') {
          result.answer += delta.content;
        } else if (Array.isArray(delta.content)) {
          for (const part of delta.content) {
            if (part?.type === 'text' && typeof part.text === 'string') {
              result.answer += part.text;
            }
            // Detect image-like parts from providers that include them in chat responses
            if (part?.type === 'image_url' && part.image_url?.url) {
              result.images = result.images || [];
              result.images.push({ url: part.image_url.url, provider: this.name, model: this._config.model });
            }
            if ((part?.type === 'output_image' || part?.type === 'inline_data') && (part.b64_json || part.data)) {
              const base64 = part.b64_json || part.data;
              const mimeType = part.mime_type || part.mimeType || 'image/png';
              result.images = result.images || [];
              result.images.push({ base64, mimeType, provider: this.name, model: this._config.model });
            }
          }
        }
      }
      
      if (delta.tool_calls) {
        if (!result.tools) {
          result.tools = [];
        }
        // Mark that we may have pending buffers to finalize
        (result as any)._hasPendingToolArgs = true;

        for (const toolCall of delta.tool_calls) {
          const id: string = toolCall.id || String(toolCall.index ?? "");
          const name: string | undefined = toolCall.function?.name;
          const argChunk: string | undefined = toolCall.function?.arguments;

          let existing = result.tools.find(t => t.id === id);
          if (!existing && id) {
            existing = { id, name: name || '', arguments: {} } as unknown as ToolRequest;
            result.tools.push(existing);
          }
          if (existing && name) {
            (existing as any).name = name;
          }

          if (!toolArgBuffers) continue;
          if (!toolArgBuffers.has(id)) {
            toolArgBuffers.set(id, { name: name || (existing as any)?.name || '', buffer: '' });
          }
          if (argChunk) {
            const acc = toolArgBuffers.get(id)!;
            acc.buffer += argChunk;
            // Try to parse incrementally; ignore errors until complete
            try {
              const parsed = JSON.parse(acc.buffer);
              existing && (existing.arguments = parsed);
            } catch {
              // keep buffering
            }
          }
        }
      }

      // Update assistant message content in the conversation
      if (result.messages.length > 0 && 
          result.messages[result.messages.length - 1].role === "assistant") {
        result.messages[result.messages.length - 1].content = result.answer;
      } else if (result.answer) {
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