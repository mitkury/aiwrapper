import {
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import {
  LangMessage,
  LangOptions,
  LanguageProvider,
} from "../language-provider.ts";
import { models } from 'aimodels';
import { LangContentPart, LangImageInput } from "../language-provider.ts";
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { LangMessages, LangToolWithHandler } from "../messages.ts";

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, any>;
};

type StreamState = {
  isReceivingThinking: boolean;
  thinkingContent: string;
  toolCalls: Array<{ id: string; name: string; arguments: any }>;
  pendingToolInputs: Map<string, { name: string; buffer: string }>;
  indexToToolId: Map<number, string>;
};

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

  constructor(options: AnthropicLangOptions) {
    const modelName = options.model || "claude-3-sonnet-20240229";
    super(modelName);

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
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messages = new LangMessages();
    if (this._config.systemPrompt) {
      messages.push({
        role: "user" as "user",
        content: this._config.systemPrompt,
      });
    }
    messages.push({ role: "user", content: prompt });
    return await this.chat(messages, options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    const { system, providerMessages, requestMaxTokens, tools } =
      this.prepareRequest(messageCollection);

    const result = messageCollection;
    const isStreaming = typeof options?.onResult === 'function';

    const requestBody: any = {
      model: this._config.model,
      messages: providerMessages,
      max_tokens: requestMaxTokens,
      system,
      ...(isStreaming ? { stream: true } : {}),
      ...(tools ? { tools } : {}),
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-api-key": this._config.apiKey
      },
      body: JSON.stringify(requestBody),
      onError: async (res: Response, error: Error): Promise<void> => {
        if (res.status === 401) {
          throw new Error("API key is invalid. Please check your API key and try again.");
        }
        if (res.status === 400) {
          const data = await res.text();
          throw new Error(data);
        }
      },
    } as any).catch((err) => { throw new Error(err); });

    if (isStreaming) {
      const streamState: StreamState = {
        isReceivingThinking: false,
        thinkingContent: "",
        toolCalls: [],
        pendingToolInputs: new Map(),
        indexToToolId: new Map(),
      };

      await processResponseStream(response, (data: any) =>
        this.handleStreamEvent(data, result, options?.onResult, streamState)
      );


      // Automatically execute tools if the assistant requested them
      const toolResults = await result.executeRequestedTools();
      if (options?.onResult && toolResults) options.onResult(toolResults);

      return result;
    }

    // Non-streaming response
    const data: any = await response.json();
    this.processNonStreamingResponse(data, result);
    result.finished = true;

    await result.executeRequestedTools();
    return result;
  }

  private prepareRequest(messageCollection: LangMessages) {
    const processedMessages: any[] = [];
    const systemContent: string[] = [];

    if (messageCollection.instructions) {
      systemContent.push(messageCollection.instructions);
    }

    for (const message of messageCollection) {
      if (message.role === "system") {
        systemContent.push(message.content as string);
      } else {
        processedMessages.push(message);
      }
    }

    const system = systemContent.join('\n\n');
    const providerMessages = this.transformMessagesForProvider(processedMessages);

    const modelInfo = models.id(this._config.model);
    if (!modelInfo) {
      console.warn(`Model info not found for ${this._config.model}`);
    }

    const requestMaxTokens = modelInfo ? calculateModelResponseTokens(
      modelInfo,
      processedMessages,
      this._config.maxTokens
    ) : this._config.maxTokens || 16000;

    let tools: AnthropicTool[] | undefined;
    if (messageCollection.availableTools?.length) {
      tools = messageCollection.availableTools.map((t) => ({
        name: t.name,
        description: t.description || "",
        input_schema: t.parameters,
      }));
    }

    return { system, providerMessages, requestMaxTokens, tools };
  }

  private handleStreamEvent(
    data: any,
    result: LangMessages,
    onResult?: (result: LangMessage) => void,
    streamState?: StreamState
  ): void {
    if (!streamState) return;

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

    if (data.type === "message_stop") {
      this.finalizeStreamingResponse(result, streamState);
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last) onResult?.(last);
      return;
    }

    if (data.type === "content_block_start") {
      if (data.content_block?.type === "tool_use") {
        const id = data.content_block.id;
        const name = data.content_block.name || '';
        const index = data.index;
        streamState.indexToToolId.set(index, id);
        streamState.pendingToolInputs.set(id, { name, buffer: '' });
        streamState.toolCalls.push({ id, name, arguments: {} });
      } else if (data.content_block?.type === "thinking") {
        streamState.isReceivingThinking = true;
      }
      return;
    }

    if (data.type === "content_block_delta") {
      if (data.delta?.type === "thinking_delta" && data.delta.thinking) {
        streamState.isReceivingThinking = true;
        streamState.thinkingContent += data.delta.thinking;
        const msg = result.appendToAssistantThinking(data.delta.thinking);
        if (msg) onResult?.(msg);
        return;
      }

      // Get tool ID from index (Anthropic uses index in content_block_delta)
      const index = data.index;
      const toolUseId = index !== undefined ? streamState.indexToToolId.get(index) : undefined;
      if (toolUseId && streamState.pendingToolInputs.has(toolUseId)) {
        this.handleToolDelta(data.delta, toolUseId, streamState);
        return;
      }

      const deltaText = data.delta.text || "";
      if (!toolUseId && deltaText) {
        if (streamState.isReceivingThinking) {
          streamState.thinkingContent += deltaText;
          const msg = result.appendToAssistantThinking(deltaText);
          if (msg) onResult?.(msg);
        } else {
          const msg = result.appendToAssistantText(deltaText);
          onResult?.(msg);
        }
      }
      return;
    }

    if (data.type === "content_block_stop") {
      if (streamState.isReceivingThinking) {
        streamState.isReceivingThinking = false;
        const msg = result.appendToAssistantThinking('');
        if (msg) onResult?.(msg);
      }
      return;
    }
  }

  private handleToolDelta(delta: any, toolUseId: string, streamState: StreamState): void {
    const acc = streamState.pendingToolInputs.get(toolUseId)!;
    const argChunk = delta.partial_json || delta.input_json_delta || delta.text;

    if (typeof argChunk === 'string') {
      acc.buffer += argChunk;
      try {
        const parsed = JSON.parse(acc.buffer);
        const entry = streamState.toolCalls.find((t) => t.id === toolUseId);
        if (entry) entry.arguments = parsed;
      } catch { }
    }
  }

  private finalizeStreamingResponse(result: LangMessages, streamState: StreamState): void {
    // Finalize tool arguments from buffered inputs
    for (const [id, acc] of streamState.pendingToolInputs) {
      const entry = streamState.toolCalls.find((t) => t.id === id);
      if (entry) {
        try {
          entry.arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
        } catch { }
      }
    }

    // Add messages in the correct order
    if (streamState.toolCalls.length > 0) {
      if (result.answer) {
        result.push({ role: "assistant", content: result.answer });
      }
      const formattedToolCalls = streamState.toolCalls.map(tc => ({
        callId: tc.id,
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments
      }));
      result.addAssistantToolCalls(formattedToolCalls);
    } else if (result.answer) {
      if (result.length === 0 || result[result.length - 1].role !== "assistant") {
        result.push({ role: "assistant", content: result.answer });
      }
    }

    result.finished = true;
  }

  private processNonStreamingResponse(data: any, result: LangMessages): void {
    if (!Array.isArray(data?.content)) return;

    const toolCalls: any[] = [];

    for (const block of data.content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        result.appendToAssistantText(block.text);
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        result.appendToAssistantThinking(block.thinking);
      } else if (block?.type === 'tool_use') {
        const toolCall = {
          id: block.id,
          name: block.name,
          arguments: block.input || {}
        };
        toolCalls.push(toolCall);
      }
    }

    if (toolCalls.length > 0) {
      if (result.answer) {
        result.push({ role: "assistant", content: result.answer });
      }
      const formattedToolCalls = toolCalls.map(tc => ({
        callId: tc.id,
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments
      }));
      result.addAssistantToolCalls(formattedToolCalls);
    } else if (result.answer) {
      result.push({ role: "assistant", content: result.answer });
    }
  }

  protected transformMessagesForProvider(messages: LangMessage[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        // Tool calls from assistant
        const contentAny = m.content as any;
        if (Array.isArray(contentAny)) {
          const blocks = contentAny.map(tc => ({
            type: 'tool_use',
            id: tc.callId || tc.id,
            name: tc.name,
            input: tc.arguments || {}
          }));
          out.push({ role: 'assistant', content: blocks });
          continue;
        }
      }
      if (m.role === 'tool-results') {
        const contentAny = m.content as any;
        if (Array.isArray(contentAny)) {
          const blocks = contentAny.map(tr => ({
            type: 'tool_result',
            tool_use_id: tr.toolId,
            content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
          }));
          out.push({ role: 'user', content: blocks });
          continue;
        }
      }
      const contentAny = m.content as any;
      if (Array.isArray(contentAny)) {
        const blocks = this.mapPartsToAnthropicBlocks(contentAny as LangContentPart[]);
        out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: blocks });
        continue;
      }
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
    return out;
  }

  private mapPartsToAnthropicBlocks(parts: LangContentPart[]): any[] {
    return parts.map(p => {
      if (p.type === 'text') {
        return { type: 'text', text: p.text };
      }
      if (p.type === 'image') {
        const src = this.imageInputToAnthropicSource(p.image);
        return { type: 'image', source: src } as any;
      }
      if (p.type === 'thinking') {
        return { type: 'thinking', thinking: p.text } as any;
      }
      // Fallback for unknown parts
      return { type: 'text', text: JSON.stringify(p) };
    });
  }

  private imageInputToAnthropicSource(image: LangImageInput): any {
    const kind: any = (image as any).kind;
    if (kind === 'base64') {
      const base64 = (image as any).base64 as string;
      const media_type = (image as any).mimeType || 'image/png';
      return { type: 'base64', media_type, data: base64 };
    }
    if (kind === 'url') {
      const url = (image as any).url as string;
      if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) throw new Error('Invalid data URL for Anthropic image');
        const media_type = match[1];
        const data = match[2];
        return { type: 'base64', media_type, data };
      }
      return { type: 'url', url };
    }
    if (kind === 'bytes' || kind === 'blob') {
      throw new Error("Anthropic image input requires base64. Convert bytes/blob to base64 first.");
    }
    throw new Error('Unknown image input kind for Anthropic');
  }
}
