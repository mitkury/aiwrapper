import {
  LangOptions,
  LanguageProvider,
  LangContentPart,
  LangImageInput,
} from "../language-provider.ts";
import { LangMessages, LangChatMessage, ToolWithHandler } from "../messages.ts";
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

    const modelInfo = models.id(config.model);
    this.modelInfo = modelInfo; // can be undefined
    this._config = config;
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
     messages: LangChatMessage[] | LangMessages,
     options?: LangOptions,
   ): Promise<LangMessages> {
     let messageCollection: LangMessages;
     if (messages instanceof LangMessages) {
       messageCollection = messages;
     } else {
       messageCollection = new LangMessages(messages);
     }
     
     const onResult = options?.onResult;
 
     const requestMaxTokens = this.modelInfo 
       ? calculateModelResponseTokens(
           this.modelInfo,
           messages,
           this._config.maxTokens
         )
       : this._config.maxTokens || 4000;
       
     if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
       this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
     }

    const toolArgBuffers = new Map<string, { name: string; buffer: string }>();

    const onData = (data: any) => {
      this.handleStreamData(data, messageCollection, messageCollection, onResult, toolArgBuffers);
    };

    const providerMessages = this.transformMessagesForProvider(messageCollection);

    const isStreaming = typeof onResult === 'function';

    const body = this.transformBody({
      model: this._config.model,
      messages: providerMessages,
      ...(isStreaming ? { stream: true } : {}),
      max_tokens: requestMaxTokens,
      ...this._config.bodyProperties,
      ...(messageCollection.availableTools ? { tools: this.formatTools(messageCollection.availableTools as ToolWithHandler[]) } : {}),
      ...(options?.schema ? { response_format: { type: 'json_object' } } : {}),
    });
 
    const commonRequest = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(isStreaming ? { "Accept": "text/event-stream" } : {}),
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

    if (isStreaming) {
      const response = await fetch(`${this._config.baseURL}/chat/completions`, commonRequest as any).catch((err) => {
        throw new Error(err);
      });

      await processResponseStream(response, onData);

      if ((messageCollection as any)._hasPendingToolArgs && toolArgBuffers.size > 0) {
        for (const [id, acc] of toolArgBuffers) {
          const entry = messageCollection.toolsRequested?.find(t => (t as any).id === id);
          if (!entry) continue;
          try {
            (entry as any).arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
          } catch {
          }
        }
      }

      return messageCollection;
    }

    const response = await fetch(`${this._config.baseURL}/chat/completions`, commonRequest as any).catch((err) => {
      throw new Error(err);
    });

    const data: any = await response.json();
    try {
      const dbg = (typeof process !== 'undefined' && process?.env?.DEBUG_OPENAI_TOOLS) || '';
      if (dbg === '1' || dbg === 'true') {
        const preview = JSON.stringify(data);
        console.log('[OpenAILike][nonstream-response]', preview.length > 4000 ? preview.slice(0, 4000) + '…' : preview);
      }
    } catch {}
    const choice = data?.choices?.[0];
    const msg = choice?.message;

    const toolCalls = msg?.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      messageCollection.toolsRequested = [] as any;
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
        (messageCollection.toolsRequested as any).push({ id, name, arguments: parsedArgs });
      }
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
          messageCollection.images = messageCollection.images || [];
          messageCollection.images.push({ url: part.image_url.url, provider: this.name, model: this._config.model });
        } else if ((part?.type === 'output_image' || part?.type === 'inline_data') && (part.b64_json || part.data)) {
          const base64 = part.b64_json || part.data;
          const mimeType = part.mime_type || part.mimeType || 'image/png';
          messageCollection.images = messageCollection.images || [];
          messageCollection.images.push({ base64, mimeType, provider: this.name, model: this._config.model });
        }
      }
    }

    if (accumulated) {
      messageCollection.answer = accumulated;
      messageCollection.addAssistantMessage(messageCollection.answer);
    }

    messageCollection.finished = true;
    return messageCollection;
   }

  protected formatTools(tools: ToolWithHandler[]): any[] {
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
    const arr = messages instanceof Array ? messages : [...messages];
    const out: any[] = [];
    for (const msg of arr) {
      if (msg.role === "tool") {
        // Treat 'tool' role here as assistant tool_calls (requested by AI)
        const contentAny = msg.content as any;
        if (Array.isArray(contentAny)) {
          out.push({
            role: "assistant",
            tool_calls: contentAny.map((call: any, index: number) => ({
              id: call.id || String(index),
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
    messages: LangMessages,
    onResult?: (result: LangMessages) => void,
    toolArgBuffers?: Map<string, { name: string; buffer: string }>
  ): void {
    if (data.finished) {
      if (toolArgBuffers && toolArgBuffers.size > 0 && result.toolsRequested) {
        for (const [id, acc] of toolArgBuffers) {
          const entry = result.toolsRequested.find((t: any) => t.id === id);
          if (!entry) continue;
          try {
            (entry as any).arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
          } catch {
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
        if (typeof delta.content === 'string') {
          result.answer += delta.content;
        } else if (Array.isArray(delta.content)) {
          for (const part of delta.content) {
            if (part?.type === 'text' && typeof part.text === 'string') {
              result.answer += part.text;
            }
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
        if (!result.toolsRequested) {
          result.toolsRequested = [] as any;
        }
        (result as any)._hasPendingToolArgs = true;

        for (const toolCall of delta.tool_calls) {
          const id: string = toolCall.id || String(toolCall.index ?? "");
          const name: string | undefined = toolCall.function?.name;
          const argChunk: string | undefined = toolCall.function?.arguments;

          let existing = (result.toolsRequested as any).find((t: any) => t.id === id);
          if (!existing && id) {
            existing = { id, name: name || '', arguments: {} } as any;
            (result.toolsRequested as any).push(existing);
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
            try {
              const parsed = JSON.parse(acc.buffer);
              existing && ((existing as any).arguments = parsed);
            } catch {
            }
          }
        }
      }

      if (result.length > 0 && 
          result[result.length - 1].role === "assistant") {
        result[result.length - 1].content = result.answer;
      } else if (result.answer) {
        result.push({
          role: "assistant",
          content: result.answer,
        });
      }

      onResult?.(result);
    }
  }

  setReasoningEffort(effort: ReasoningEffort): OpenAILikeLang {
    this._config.reasoningEffort = effort;
    return this;
  }

  getReasoningEffort(): ReasoningEffort | undefined {
    return this._config.reasoningEffort;
  }

  setMaxCompletionTokens(maxTokens: number): OpenAILikeLang {
    this._config.maxCompletionTokens = maxTokens;
    return this;
  }

  getMaxCompletionTokens(): number | undefined {
    return this._config.maxCompletionTokens;
  }
}