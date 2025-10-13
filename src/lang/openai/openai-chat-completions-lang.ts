import {
  LangOptions,
  LanguageProvider,
  LangContentPart,
  LangImageInput,
} from "../language-provider.ts";
import { LangMessages, LangMessage, LangTool } from "../messages.ts";
import {
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

type OpenAICompletionsTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
};

export class OpenAIChatCompletionsLang extends LanguageProvider {
  protected _config: OpenAILikeConfig;
  protected modelInfo?: Model;

  constructor(config: OpenAILikeConfig) {
    super(config.model);

    const modelInfo = models.id(config.model);
    this.modelInfo = modelInfo; // can be undefined
    this._config = config;
  }

  /** Decide how many tokens to request based on model info and optional limits */
  private computeRequestMaxTokens(messageCollection: LangMessages): number {
    if (this.modelInfo) {
      return calculateModelResponseTokens(
        this.modelInfo,
        messageCollection,
        this._config.maxTokens
      );
    }
    return this._config.maxTokens || 4000;
  }

  /** Build OpenAI-like request body including tools and json schema toggles */
  private buildRequestBody(
    messageCollection: LangMessages,
    isStreaming: boolean,
    requestMaxTokens: number,
    options?: LangOptions,
  ): Record<string, unknown> {
    const providerMessages = this.transformMessagesForProvider(messageCollection);
    const base: Record<string, unknown> = {
      model: this._config.model,
      messages: providerMessages,
      ...(isStreaming ? { stream: true } : {}),
      max_tokens: requestMaxTokens,
      ...this._config.bodyProperties,
      ...(messageCollection.availableTools ? { tools: this.formatTools(messageCollection.availableTools) } : {}),
      ...(options?.schema ? { response_format: { type: 'json_object' } } : {}),
    };
    return this.transformBody(base);
  }

  /** Build common request init for fetch */
  private buildCommonRequest(isStreaming: boolean, body: Record<string, unknown>) {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(isStreaming ? { "Accept": "text/event-stream" } : {}),
        ...(this._config.apiKey ? { "Authorization": `Bearer ${this._config.apiKey}` } : {}),
        ...this._config.headers,
      },
      body: JSON.stringify(body),
      onError: async (res: Response, _error: Error): Promise<void> => {
        if (res.status === 401) {
          throw new Error(
            "Authentication failed. Please check your credentials and try again.",
          );
        }
        if (res.status === 400) {
          const data = await res.text();
          throw new Error(data);
        }
        // For other errors, let the default retry behavior handle it
      },
    } as const;
  }

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
  }): OpenAIChatCompletionsLang {
    return new OpenAIChatCompletionsLang({
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
  ): Promise<LangMessages> {
    const messages = new LangMessages();
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
    if (this._config.reasoningEffort && this.supportsReasoning()) {
      transformedBody.reasoning_effort = this._config.reasoningEffort;
    }
    if (this._config.maxCompletionTokens !== undefined && this.supportsReasoning()) {
      transformedBody.max_completion_tokens = this._config.maxCompletionTokens;
    }
    return transformedBody;
  }

  supportsReasoning(): boolean {
    if (this.modelInfo) {
      return this.modelInfo.canReason();
    }
    return false;
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const result = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    const onResult = options?.onResult;
    const isStreaming = typeof onResult === 'function';

    const requestMaxTokens = this.computeRequestMaxTokens(result);
    if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
      this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
    }

    const body = this.buildRequestBody(result, isStreaming, requestMaxTokens, options);
    const commonRequest = this.buildCommonRequest(isStreaming, body);

    if (isStreaming) {
      const toolArgBuffers = new Map<string, { name: string; buffer: string }>();
      const onData = (data: any) => {
        this.handleStreamData(data, result, onResult, toolArgBuffers);
      };

      const response = await fetch(`${this._config.baseURL}/chat/completions`, commonRequest as any).catch((err) => {
        throw new Error(err);
      });

      await processResponseStream(response, onData);

      result.finished = true;

      // Automatically execute tools if the assistant requested them
      const toolResults = await result.executeRequestedTools();
      if (options?.onResult && toolResults) options.onResult(toolResults);

      return result;
    }

    const response = await fetch(`${this._config.baseURL}/chat/completions`, commonRequest as any).catch((err) => {
      throw new Error(err);
    });

    const data: any = await response.json();
    const choice = data?.choices?.[0];
    const msg = choice?.message;

    const toolCalls = msg?.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const toolCallMessages: any[] = [];
      for (const tc of toolCalls) {
        const id: string = tc?.id || '';
        const name: string = tc?.function?.name || '';
        const rawArgs: string = tc?.function?.arguments || '';
        let parsedArgs: Record<string, unknown> = {};
        if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
          }
        }
        toolCallMessages.push({ callId: id, name, arguments: parsedArgs });
      }

      // Add tool calls as assistant messages
      result.addAssistantToolCalls(toolCallMessages);
    }
    let accumulated = '';

    if (typeof msg?.content === 'string') {
      accumulated = msg.content;
    } else if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') {
          accumulated += part;
        } else if (part?.type === 'text' && typeof part.text === 'string') {
          accumulated += part.text;
        } else if (part?.type === 'image_url' && part.image_url?.url) {
          const url = part.image_url.url;
          result.addAssistantImage({ kind: 'url', url });
        } else if ((part?.type === 'output_image' || part?.type === 'inline_data') && (part.b64_json || part.data)) {
          const base64 = part.b64_json || part.data;
          const mimeType = part.mime_type || part.mimeType || 'image/png';
          result.addAssistantImage({ kind: 'base64', base64, mimeType });
        }
      }
    }

    if (accumulated) {
      const msg = result.ensureAssistantTextMessage();
      msg.content = accumulated;
    }

    result.finished = true;

    // Automatically execute tools if the assistant requested them
    const toolResults = await result.executeRequestedTools();
    if (options?.onResult && toolResults) options.onResult(toolResults);

    return result;
  }

  protected formatTools(tools: LangTool[]): OpenAICompletionsTool[] {
    return tools.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  protected transformMessagesForProvider(messages: LangMessages): any[] {
    const out: any[] = [];
    for (const msg of messages) {
      if (msg.role === "tool") {
        // Treat 'tool' role here as assistant tool_calls (requested by AI)
        const contentAny = msg.content as any;
        if (Array.isArray(contentAny)) {
          out.push({
            role: "assistant",
            tool_calls: contentAny.map((call: any, index: number) => ({
              id: call.callId || call.id || String(index),
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments || {})
              }
            }))
          });
          continue;
        }
      }
      if (msg.role === "tool-results") {
        const contentAny = msg.content as any;
        if (Array.isArray(contentAny)) {
          for (const tr of contentAny) {
            out.push({
              role: "tool",
              tool_call_id: tr.toolId,
              name: tr.name,
              content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
            });
          }
          continue;
        }
      }
      const content = (msg as any).content;
      if (Array.isArray(content)) {
        const parts = this.mapContentPartsToOpenAI(content as LangContentPart[]);
        out.push({ role: msg.role, content: parts });
        continue;
      }
      out.push(msg);
    }

    // Add instructions as the first system message
    if (messages.instructions) {
      out.unshift({ role: "system", content: messages.instructions });
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

  protected handleStreamData(
    data: any,
    result: LangMessages,
    onResult?: (result: LangMessage) => void,
    toolArgBuffers?: Map<string, { name: string; buffer: string }>
  ): void {
    const ensureAssistantMessage = (): LangMessage => {
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last && last.role === "assistant" && typeof last.content === "string") {
        return last;
      }
      result.addAssistantMessage("");
      return result[result.length - 1];
    };

    const ensureToolMessage = (): LangMessage => {
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last && last.role === "tool" && Array.isArray(last.content)) {
        return last;
      }
      result.addAssistantToolCalls([]);
      return result[result.length - 1];
    };
    if (data.finished) {
      if (toolArgBuffers && toolArgBuffers.size > 0 && result.toolsRequested) {
        for (const [id, acc] of toolArgBuffers) {
          const entry = (result.toolsRequested as any).find((t: any) => t.id === id || t.callId === id);
          if (entry) {
            try {
              (entry as any).arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
            } catch { }
          }
        }
      }
      (result as any)._hasPendingToolArgs = false;
      result.finished = true;
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last) onResult?.(last);
      return;
    }

    if (data.choices !== undefined) {
      const delta = data.choices[0].delta;

      if (delta.reasoning_content) {
        const msg = result.appendToAssistantThinking(delta.reasoning_content);
        if (msg) onResult?.(msg);
      }

      if (delta.content) {
        if (typeof delta.content === 'string') {
          const msg = result.appendToAssistantText(delta.content);
          onResult?.(msg);
        } else if (Array.isArray(delta.content)) {
          let appended = false;
          for (const part of delta.content) {
            if (part?.type === 'text' && typeof part.text === 'string') {
              const msg = result.appendToAssistantText(part.text);
              onResult?.(msg);
              appended = true;
            }
            if (part?.type === 'image_url' && part.image_url?.url) {
              const url = part.image_url.url;
              result.addAssistantImage({ kind: 'url', url });
            }
            if ((part?.type === 'output_image' || part?.type === 'inline_data') && (part.b64_json || part.data)) {
              const base64 = part.b64_json || part.data;
              const mimeType = part.mime_type || part.mimeType || 'image/png';
              result.addAssistantImage({ kind: 'base64', base64, mimeType });
            }
          }
          if (!appended) {
            const msg = ensureAssistantMessage();
            onResult?.(msg);
          }
        }
      }

      if (delta.tool_calls) {
        (result as any)._hasPendingToolArgs = true;
        const toolMsg = ensureToolMessage();
        const toolContent = (toolMsg.content as any[]);

        for (const toolCall of delta.tool_calls) {
          const id: string = toolCall.id || String(toolCall.index ?? "");
          const name: string | undefined = toolCall.function?.name;
          const argChunk: string | undefined = toolCall.function?.arguments;

          let existing = (result.toolsRequested as any).find((t: any) => t.id === id || t.callId === id);
          if (!existing && id) {
            existing = { id, name: name || '', arguments: {} } as any;
            (result.toolsRequested as any).push(existing);
          }
          if (existing && name) {
            (existing as any).name = name;
          }

          // Reflect tool requests in the transcript message immediately
          let msgEntry = toolContent.find((c: any) => c.callId === id || c.id === id);
          if (!msgEntry) {
            msgEntry = { callId: id, name: name || '', arguments: {} };
            toolContent.push(msgEntry);
          } else if (name) {
            msgEntry.name = name;
          }

          if (!toolArgBuffers) continue;
          if (!toolArgBuffers.has(id)) {
            toolArgBuffers.set(id, { name: name || (existing as any)?.name || '', buffer: '' });
          }
          if (argChunk) {
            const acc = toolArgBuffers.get(id)!;
            acc.buffer += argChunk;
            try {
              const parsed = JSON.parse(acc.buffer);
              if (existing) (existing as any).arguments = parsed;
              msgEntry.arguments = parsed;
            } catch {
            }
          }
        }
        onResult?.(toolMsg);
      }

      if (result.answer) {
        const msg = ensureAssistantMessage();
        onResult?.(msg);
      }
    }
  }

  setReasoningEffort(effort: ReasoningEffort): OpenAIChatCompletionsLang {
    this._config.reasoningEffort = effort;
    return this;
  }

  getReasoningEffort(): ReasoningEffort | undefined {
    return this._config.reasoningEffort;
  }

  setMaxCompletionTokens(maxTokens: number): OpenAIChatCompletionsLang {
    this._config.maxCompletionTokens = maxTokens;
    return this;
  }

  getMaxCompletionTokens(): number | undefined {
    return this._config.maxCompletionTokens;
  }
}