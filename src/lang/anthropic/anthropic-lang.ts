import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import {
  LangChatMessageCollection,
  LangChatMessage,
  LangOptions,
  LanguageProvider,
} from "../language-provider.ts";
import { models } from 'aimodels';
import { LangContentPart, LangImageInput } from "../language-provider.ts";
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { LangMessages, ToolWithHandler } from "../messages.ts";

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, any>;
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
    messages: LangChatMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages
      : (messages instanceof LangChatMessageCollection ? new LangMessages(messages as any) : new LangMessages(messages));

    const processedMessages: any[] = [];
    let systemContent = '';

    for (const message of messageCollection as any) {
      if ((message as any).role === "system") {
        systemContent += (message as any).content + '\n';
      } else {
        processedMessages.push(message);
      }
    }

    const providerMessages = this.transformMessagesForProvider(processedMessages as any);

    const modelInfo = models.id(this._config.model);
    if (!modelInfo) {
      throw new Error(`Model info not found for ${this._config.model}`);
    }

    const requestMaxTokens = calculateModelResponseTokens(
      modelInfo,
      processedMessages,
      this._config.maxTokens
    );

    let isReceivingThinking = false;
    let thinkingContent = "";
    const pendingToolInputs = new Map<string, { name: string; buffer: string }>();

    const onResult = options?.onResult;
    const isStreaming = typeof onResult === 'function';

    const result = messageCollection;

    const onData = (data: any) => {
      if (data.type === "message_stop") {
        if (result.toolsRequested && result.toolsRequested.length > 0) {
          for (const [id, acc] of pendingToolInputs) {
            const entry = (result.toolsRequested as any).find((t: any) => t.id === id);
            if (!entry) continue;
            try {
              (entry as any).arguments = acc.buffer ? JSON.parse(acc.buffer) : {};
            } catch {}
          }
        }
        result.thinking = thinkingContent;
        result.finished = true;
        onResult?.(result as any);
        return;
      }

      if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
        const id = data.content_block?.id;
        const name = data.content_block?.name || '';
        if (!result.toolsRequested) result.toolsRequested = [] as any;
        (result.toolsRequested as any).push({ id, name, arguments: {} });
        pendingToolInputs.set(id, { name, buffer: '' });
        return;
      }

      if (data.type === "content_block_delta") {
        if (data.delta?.type === "thinking_delta" && data.delta.thinking) {
          isReceivingThinking = true;
          thinkingContent += data.delta.thinking;
          result.thinking = thinkingContent;
          onResult?.(result as any);
          return;
        }

        const toolUseId = data.content_block_id;
        if (toolUseId && pendingToolInputs.has(toolUseId)) {
          const acc = pendingToolInputs.get(toolUseId)!;
          if (typeof data.delta?.partial_json === 'string') {
            acc.buffer += data.delta.partial_json;
            try {
              const parsed = JSON.parse(acc.buffer);
              const entry = (result.toolsRequested as any)?.find((t: any) => t.id === toolUseId);
              if (entry) (entry as any).arguments = parsed;
            } catch {}
            return;
          }
          if (data.delta?.input_json_delta && typeof data.delta.input_json_delta === 'string') {
            acc.buffer += data.delta.input_json_delta;
            try {
              const parsed = JSON.parse(acc.buffer);
              const entry = (result.toolsRequested as any)?.find((t: any) => t.id === toolUseId);
              if (entry) (entry as any).arguments = parsed;
            } catch {}
            return;
          }
          if (data.delta?.text) {
            acc.buffer += data.delta.text;
            return;
          }
        }

        const deltaContent = data.delta.text ? data.delta.text : "";
        if (!toolUseId) {
          if (isReceivingThinking) {
            thinkingContent += deltaContent;
            result.thinking = thinkingContent;
            onResult?.(result as any);
            return;
          }
          result.answer += deltaContent;
          if (result.length > 0 && result[result.length - 1].role === "assistant") {
            result[result.length - 1].content = result.answer;
          } else {
            result.push({ role: "assistant", content: result.answer });
          }
          onResult?.(result as any);
          return;
        }
      }

      if (data.type === "content_block_stop" && data.content_block?.type === "tool_use") {
        const id = data.content_block?.id;
        if (id && pendingToolInputs.has(id)) {
          const acc = pendingToolInputs.get(id)!;
          const entry = (result.toolsRequested as any)?.find((t: any) => t.id === id);
          if (entry) {
            try { (entry as any).arguments = acc.buffer ? JSON.parse(acc.buffer) : {}; } catch {}
          }
        }
        return;
      }

      if (data.type === "content_block_start" && data.content_block?.type === "thinking") {
        isReceivingThinking = true;
        return;
      }

      if (data.type === "content_block_stop" && isReceivingThinking) {
        isReceivingThinking = false;
        result.thinking = thinkingContent;
        onResult?.(result as any);
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
          
          if (result.length > 0 && 
              result[result.length - 1].role === "assistant") {
            result[result.length - 1].content = result.answer;
          } else {
            result.push({ role: "assistant", content: result.answer });
          }
          
          onResult?.(result as any);
        }
      }
    };
    
    // Prepare tools from messages.tools
    let tools: AnthropicTool[] | undefined;
    if (messageCollection.availableTools && Array.isArray(messageCollection.availableTools)) {
      const arr = messageCollection.availableTools as ToolWithHandler[];
      tools = arr.map((t) => ({
        name: t.name,
        description: t.description || "",
        input_schema: t.parameters,
      }));
    }
    
    const requestBody: any = {
      model: this._config.model,
      messages: providerMessages,
      max_tokens: requestMaxTokens,
      system: systemContent,
      ...(isStreaming ? { stream: true } : {}),
      ...(tools ? { tools } : {}),
    };

    const commonRequest = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-api-key": this._config.apiKey
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
          throw new Error(
            data,
          );
        }

        return decision;
      },
    } as const;

    if (isStreaming) {
      const response = await fetch("https://api.anthropic.com/v1/messages", commonRequest as any)
        .catch((err) => { throw new Error(err); });

      await processResponseStream(response, onData);
      return result;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", commonRequest as any)
      .catch((err) => { throw new Error(err); });

    const data: any = await response.json();
    if (Array.isArray(data?.content)) {
      for (const block of data.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          result.answer += block.text;
        }
      }
    }
    if (result.answer) {
      result.push({ role: "assistant", content: result.answer });
    }
    result.finished = true;
    return result;
  }

  protected transformMessagesForProvider(messages: LangChatMessage[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
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
      const src = this.imageInputToAnthropicSource(p.image);
      return { type: 'image', source: src } as any;
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
