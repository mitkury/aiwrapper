import {
  LangOptions,
  LanguageProvider,
} from "../language-provider.ts";
import {
  LangMessages,
  LangMessage,
  LangTool,
  LangMessageItemImage,
  LangMessageItemText,
  LangMessageItemTool,
  LangMessageItemToolResult,
} from "../messages.ts";
import {
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processServerEvents } from "../../process-server-events.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { addInstructionAboutSchema } from "../prompt-for-json.ts";
import { OpenAIChatCompletionsStreamHandler } from "./openai-chat-completions-stream-handler.ts";

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

const STREAM_HANDLER_SYMBOL = Symbol("OpenAIChatCompletionsStreamHandler");

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
      ...(options?.providerSpecificBody ?? {}),
    };
    if (messageCollection.availableTools) {
      base.tools = this.formatTools(messageCollection.availableTools);
    }
    return this.transformBody(base);
  }

  /** Build common request init for fetch */
  private buildCommonRequest(body: Record<string, unknown>, options?: LangOptions) {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Always request SSE for streaming
        "Accept": "text/event-stream",
        ...(this._config.apiKey ? { "Authorization": `Bearer ${this._config.apiKey}` } : {}),
        ...this._config.headers,
        ...(options?.providerSpecificHeaders ?? {}),
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
      messages.push(new LangMessage("user", this._config.systemPrompt));
    }

    messages.push(new LangMessage("user", prompt));

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
    const commonRequest = this.buildCommonRequest(body, options);
    const onData = (data: any) => {
      this.handleStreamData(data, result, options?.onResult);
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

    if (this._config.systemPrompt) {
      out.push({ role: "system", content: this._config.systemPrompt });
    }
    if (messages.instructions) {
      out.push({ role: "system", content: messages.instructions });
    }

    for (const msg of messages) {
      if (msg.role === "tool-results") {
        const toolMessages = this.mapToolResultsMessage(msg);
        out.push(...toolMessages);
        continue;
      }

      if (msg.role !== "user" && msg.role !== "assistant") {
        continue;
      }

      const mapped = this.mapMessageForProvider(msg);
      if (mapped) {
        out.push(mapped);
      }
    }

    return out;
  }

  protected handleStreamData(
    data: any,
    result: LangMessages,
    onResult?: (result: LangMessage) => void,
    _toolArgBuffers?: Map<string, { name: string; buffer: string }>
  ): void {
    let handler = (result as any)[STREAM_HANDLER_SYMBOL] as OpenAIChatCompletionsStreamHandler | undefined;
    if (!handler) {
      handler = new OpenAIChatCompletionsStreamHandler(result, onResult);
      (result as any)[STREAM_HANDLER_SYMBOL] = handler;
    } else if (onResult) {
      handler.setOnResult(onResult);
    }

    handler.handleEvent(data);

    if (data?.finished) {
      result.finished = true;
      delete (result as any)[STREAM_HANDLER_SYMBOL];
    }
  }

  private mapMessageForProvider(message: LangMessage): any | null {
    const contentParts = this.buildContentParts(message);
    const toolCalls = this.buildToolCalls(message);

    if (contentParts.length === 0 && toolCalls.length === 0) {
      if (message.role === "assistant") {
        return { role: "assistant", content: "" };
      }
      if (message.role === "user") {
        return { role: "user", content: "" };
      }
      return null;
    }

    const payload: Record<string, unknown> = { role: message.role };

    if (contentParts.length > 0) {
      if (contentParts.length === 1 && contentParts[0].type === "text") {
        payload.content = contentParts[0].text;
      } else {
        payload.content = contentParts;
      }
    }

    if (toolCalls.length > 0) {
      payload.tool_calls = toolCalls;
      if (!("content" in payload)) {
        payload.content = "";
      }
    }

    return payload;
  }

  private buildContentParts(message: LangMessage): any[] {
    const parts: any[] = [];
    for (const item of message.items) {
      if (item.type === "text") {
        const textItem = item as LangMessageItemText;
        if (typeof textItem.text === "string" && textItem.text.length > 0) {
          parts.push({ type: "text", text: textItem.text });
        }
      } else if (item.type === "image") {
        const imageItem = item as LangMessageItemImage;
        const imageParts = this.mapImageItemToContentParts(imageItem);
        if (imageParts.length > 0) {
          parts.push(...imageParts);
        }
      } else if (item.type === "reasoning") {
        // Skip reasoning items when sending context back to providers
        continue;
      }
    }
    return parts;
  }

  private buildToolCalls(message: LangMessage): any[] {
    const calls: any[] = [];
    let fallbackIndex = 0;
    for (const item of message.items) {
      if (item.type !== "tool") continue;
      const toolItem = item as LangMessageItemTool;
      const id = toolItem.callId || `tool_call_${fallbackIndex++}`;
      calls.push({
        id,
        type: "function",
        function: {
          name: toolItem.name,
          arguments: JSON.stringify(toolItem.arguments ?? {}),
        },
      });
    }
    return calls;
  }

  private mapToolResultsMessage(message: LangMessage): any[] {
    const toolMessages: any[] = [];
    for (const item of message.items) {
      if (item.type !== "tool-result") continue;
      const toolResult = item as LangMessageItemToolResult;
      const rawResult = toolResult.result;
      const content = typeof rawResult === "string"
        ? rawResult
        : JSON.stringify(rawResult ?? {});
      toolMessages.push({
        role: "tool",
        tool_call_id: toolResult.callId,
        name: toolResult.name,
        content,
      });
    }
    return toolMessages;
  }

  private mapImageItemToContentParts(image: LangMessageItemImage): any[] {
    const parts: any[] = [];

    let imageUrl: string | undefined;
    if (typeof image.url === "string" && image.url.length > 0) {
      imageUrl = image.url;
    } else if (typeof image.base64 === "string" && image.base64.length > 0) {
      const mimeType = image.mimeType || "image/png";
      imageUrl = `data:${mimeType};base64,${image.base64}`;
    }

    if (imageUrl) {
      parts.push({ type: "image_url", image_url: { url: imageUrl } });
    }

    const metadataDescription = this.extractImageMetadataDescription(image);
    if (metadataDescription) {
      parts.push({ type: "text", text: metadataDescription });
    }

    return parts;
  }

  private extractImageMetadataDescription(image: LangMessageItemImage): string | undefined {
    const metadata = image.metadata;
    if (!metadata) return undefined;

    const description =
      typeof metadata.revisedPrompt === "string" && metadata.revisedPrompt.length > 0
        ? metadata.revisedPrompt
        : typeof metadata.description === "string" && metadata.description.length > 0
          ? metadata.description
          : undefined;

    if (!description) return undefined;

    return `Image description: ${description}`;
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