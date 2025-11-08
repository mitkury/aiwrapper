import {
  LangOptions,
  LanguageProvider,
  LangContentPart,
  LangImageInput,
  LangResponseSchema,
} from "../language-provider.ts";
import { LangMessages, LangMessage, LangTool, LangMessage as ConversationMessage } from "../messages.ts";
import {
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processServerEvents } from "../../process-server-events.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import zodToJsonSchema from "zod-to-json-schema";
import { isZodSchema } from "../schema/schema-utils.ts";
import { addInstructionAboutSchema } from "../prompt-for-json.ts";

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
    return this._config.maxTokens || 32000;
  }

  /** Build OpenAI-like request body including tools and json schema toggles */
  private buildRequestBody(
    messageCollection: LangMessages,
    requestMaxTokens: number,
    options?: LangOptions,
  ): Record<string, unknown> {
    const providerMessages = this.transformMessagesForProvider(messageCollection);
    const base: Record<string, unknown> = {
      model: this._config.model,
      messages: providerMessages,
      stream: true,
      max_tokens: requestMaxTokens,
      ...this._config.bodyProperties,
      ...(messageCollection.availableTools ? { tools: this.formatTools(messageCollection.availableTools) } : {}),
    };
    return this.transformBody(base);
  }

  /** Build common request init for fetch */
  private buildCommonRequest(body: Record<string, unknown>) {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Always request SSE for streaming
        "Accept": "text/event-stream",
        ...(this._config.apiKey ? { "Authorization": `Bearer ${this._config.apiKey}` } : {}),
        ...this._config.headers,
      },
      body: JSON.stringify(body),
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
      messages.push(new ConversationMessage("user", this._config.systemPrompt));
    }

    messages.push(new ConversationMessage("user", prompt));

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

    if (options?.schema) {
      const baseInstruction = result.instructions + '\n\n' || '';
      result.instructions = baseInstruction + addInstructionAboutSchema(options.schema);
    }

    const requestMaxTokens = this.computeRequestMaxTokens(result);
    if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
      this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
    }

    const body = this.buildRequestBody(result, requestMaxTokens, options);
    const commonRequest = this.buildCommonRequest(body);

    const toolArgBuffers = new Map<string, { name: string; buffer: string }>();
    const onData = (data: any) => {
      this.handleStreamData(data, result, options?.onResult, toolArgBuffers);
    };

    const response = await fetch(`${this._config.baseURL}/chat/completions`, commonRequest as any).catch((err) => {
      throw new Error(err);
    });

    await processServerEvents(response, onData);

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
      const content = (msg as any).content;
      if (Array.isArray(content) && content.every((part: any) => part && typeof part.type === "string")) {
        const parts = this.mapContentPartsToOpenAI(content as LangContentPart[]);
        if (parts.length > 0) {
          out.push({ role: msg.role, content: parts });
        }
      } else if (typeof content === "string" && content.length > 0) {
        out.push({ role: msg.role, content: [{ type: "text", text: content }] });
      }

      if (msg.role === "assistant" && msg.toolRequests.length > 0) {
        out.push({
          role: "assistant",
          tool_calls: msg.toolRequests.map((call, index) => ({
            id: call.callId || String(index),
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments || {})
            }
          }))
        });
      }

      if (msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          out.push({
            role: "tool",
            tool_call_id: tr.callId,
            name: tr.name,
            content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
          });
        }
      }
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


    const ensureToolMessage = (): LangMessage => {
      return result.addAssistantToolCalls([]);
    };

    const findLastAssistantWithTools = (): LangMessage | undefined => {
      for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i];
        if (msg.role === "assistant" && msg.toolRequests.length > 0) {
          return msg;
        }
      }
      return undefined;
    };

    if (data.finished) {
      // Finalize any buffered tool arguments onto the last tool message
      if (toolArgBuffers && toolArgBuffers.size > 0) {
        const lastToolMsg = findLastAssistantWithTools();
        if (lastToolMsg) {
          for (const [id, acc] of toolArgBuffers) {
            const toolItem = lastToolMsg.toolRequests.find(t => t.callId === id);
            if (!toolItem) continue;
            try {
              toolItem.arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
            } catch {
              toolItem.arguments = {};
            }
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
          // Do not create an empty assistant message when nothing was appended
        }
      }

      if (delta.tool_calls) {
        (result as any)._hasPendingToolArgs = true;
        const toolMsg = ensureToolMessage();

        for (const toolCall of delta.tool_calls) {
          const id: string = toolCall.id || String(toolCall.index ?? "");
          const name: string | undefined = toolCall.function?.name;
          const argChunk: string | undefined = toolCall.function?.arguments;

          const toolItem = toolMsg.upsertToolCall({
            callId: id,
            name: name || "",
            arguments: {},
          });

          if (!toolArgBuffers) continue;
          if (!toolArgBuffers.has(id)) {
            toolArgBuffers.set(id, { name: name || toolItem.name || '', buffer: '' });
          }
          if (argChunk) {
            const acc = toolArgBuffers.get(id)!;
            acc.buffer += argChunk;
            try {
              const parsed = JSON.parse(acc.buffer);
              toolItem.arguments = parsed;
            } catch {
            }
          }
        }
        onResult?.(toolMsg);
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