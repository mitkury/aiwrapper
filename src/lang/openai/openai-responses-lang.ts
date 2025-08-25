import {
  LangChatMessageCollection,
  LangChatMessage,
  LangOptions,
  LanguageProvider,
  LangContentPart,
  LangImageInput
} from "../language-provider.ts";
import { LangMessages } from "../messages.ts";
import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import type { ResponsesStreamEvent } from "./responses-stream-types.ts";
type FinishedEvent = { finished: true };

// Minimal per-item buffers for concurrent stream updates
type StreamItemBuffers = Map<string, { parts: Map<number, string> }>; // key: item_id

export type OpenAIResponsesOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
};

export class OpenAIResponsesLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _baseURL = "https://api.openai.com/v1";

  constructor(options: OpenAIResponsesOptions) {
    if (!options.model) {
      throw new Error("Model is required");
    }

    const modelName = options.model;
    super(modelName);
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangMessages> {
    const messages = new LangChatMessageCollection();
    if (this._systemPrompt) {
      messages.push({ role: "system", content: this._systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    return this.chat(messages as any, options);
  }

  async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages
      : (messages instanceof LangChatMessageCollection ? new LangMessages(messages as any) : new LangMessages(messages));

    const result = messageCollection;

    const input = this.transformMessagesToResponsesInput(messageCollection);

    const stream = typeof options?.onResult === 'function';

    const body: any = {
      model: this._model,
      input,
      ...(typeof (options as any)?.maxTokens === 'number' ? { max_output_tokens: (options as any).maxTokens } : {}),
      ...(stream ? { stream: true } : {}),
      ...(this._systemPrompt ? { instructions: this._systemPrompt } : {}),
    };

    const url = `${this._baseURL}/responses`;

    const common = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._apiKey}`,
        ...(stream ? { "Accept": "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
      onNotOkResponse: async (res: Response, decision: DecisionOnNotOkResponse): Promise<DecisionOnNotOkResponse> => {
        if (res.status === 401) {
          decision.retry = false;
          throw new Error("Authentication failed. Please check your credentials and try again.");
        }
        if (res.status === 400) {
          const data = await res.text();
          decision.retry = false;
          throw new Error(data);
        }
        return decision;
      },
    } as const;

    if (stream) {
      const response = await fetch(url, common as any);

      // Keep minimal mutable stream state between events
      const streamState = { sawAnyTextDelta: false };
      const itemBuffers: StreamItemBuffers = new Map();

      // Route raw SSE events through a dedicated handler
      const onData = (data: ResponsesStreamEvent | FinishedEvent) => this.handleStreamingEvent(
        data,
        result,
        options?.onResult,
        streamState,
        itemBuffers,
      );

      await processResponseStream(response, onData);
      return result;
    }

    const response = await fetch(`${this._baseURL}/responses`, common as any);
    const data: any = await response.json();

    let outputText = data?.output_text || data?.content?.[0]?.text || data?.choices?.[0]?.message?.content?.[0]?.text;
    if (typeof outputText === 'string') {
      result.answer = outputText;
      result.addAssistantMessage(result.answer);
    } else if (Array.isArray(data?.output)) {
      for (const item of data.output) {
        if (item?.type === 'output_text' && typeof item.text === 'string') {
          result.answer += item.text;
        } else if (item?.type === 'text' && typeof item.text === 'string') {
          result.answer += item.text;
        } else if (item?.type === 'image_generation_call' && typeof item.result === 'string') {
          const base64 = item.result;
          result.images = result.images || [];
          result.images.push({ base64, mimeType: 'image/png', provider: this.name, model: this._model });
        } else if (Array.isArray(item?.content)) {
          const first = item.content[0];
          if (first?.type === 'output_text' && typeof first.text === 'string') {
            result.answer += first.text;
          }
        }
        if (item?.type === 'output_image') {
          if (item.image_url) {
            result.images = result.images || [];
            result.images.push({ url: item.image_url, provider: this.name, model: this._model });
          }
          if (item.b64_json || item.base64 || item.data) {
            const base64 = item.b64_json || item.base64 || item.data;
            const mimeType = item.mime_type || item.mimeType || 'image/png';
            result.images = result.images || [];
            result.images.push({ base64, mimeType, provider: this.name, model: this._model });
          }
        }
      }
      if (result.answer) {
        result.addAssistantMessage(result.answer);
      }
    }

    result.finished = true;
    return result;
  }

  private transformMessagesToResponsesInput(messages: LangChatMessageCollection): any {
    // If there is exactly one user message with plain text and no other context, send a bare string
    const plainUserMessages = messages.filter(m => m.role === 'user' && typeof (m as any).content === 'string');
    const hasAssistant = messages.some(m => m.role === 'assistant');
    const hasStructured = messages.some(m => Array.isArray((m as any).content));
    const hasImages = messages.some(m => Array.isArray((m as any).content) && (m as any).content.some((p: any) => p?.type === 'image'));
    if (!hasAssistant && !hasStructured && !hasImages && plainUserMessages.length === 1 && messages.length === 1) {
      return String((plainUserMessages[0] as any).content);
    }

    // Otherwise, build Responses-style structured input array
    const input: any[] = [];
    for (const m of messages) {
      const entry: any = { role: m.role === 'assistant' ? 'assistant' : m.role, content: [] as any[] };
      const content = (m as any).content;
      if (Array.isArray(content)) {
        for (const part of content as LangContentPart[]) {
          if (part.type === 'text') {
            const isAssistant = m.role === 'assistant';
            entry.content.push({ type: isAssistant ? 'output_text' : 'input_text', text: part.text });
          } else if (part.type === 'image') {
            const mapped = this.mapImageInput(part.image);
            entry.content.push(mapped);
          }
        }
      } else {
        const isAssistant = m.role === 'assistant';
        entry.content.push({ type: isAssistant ? 'output_text' : 'input_text', text: String(content) });
      }
      input.push(entry);
    }
    return input;
  }

  /**
   * Handle one SSE event from the Responses API stream.
   * This function normalizes different streaming shapes into a unified answer:
   * - response.output_text.delta: append incremental tokens to result.answer
   * - response.output_text.done: set final text for the content part
   * - response.content_part.done / response.output_item.done: append full text when deltas weren't sent
   * - response.completed / response.incomplete: finalize the message and mark finished
   */
  private handleStreamingEvent(
    data: ResponsesStreamEvent | FinishedEvent,
    result: LangMessages,
    onResult?: (result: LangMessages) => void,
    streamState?: { sawAnyTextDelta: boolean },
    itemBuffers?: StreamItemBuffers,
  ): void {
    // Completion or interruption
    if ('finished' in data && data.finished) {
      if (result.answer) {
        if (result.length > 0 && result[result.length - 1].role === 'assistant') {
          (result as any)[result.length - 1].content = result.answer;
        } else {
          result.addAssistantMessage(result.answer);
        }
      }
      result.finished = true;
      onResult?.(result);
      return;
    }

    // Typed events via discriminated union
    if ('type' in data) switch (data.type) {
      case 'response.completed':
      case 'response.incomplete': {
        if (result.answer) {
          if (result.length > 0 && result[result.length - 1].role === 'assistant') {
            (result as any)[result.length - 1].content = result.answer;
          } else {
            result.addAssistantMessage(result.answer);
          }
        }
        result.finished = true;
        onResult?.(result);
        return;
      }
      case 'response.output_item.done': {
        const item = data.item;
        if (item.type === 'message' && Array.isArray(item.content)) {
          // If we buffered parts (no deltas), consolidate
          const buf = itemBuffers?.get(item.id);
          if (buf && buf.parts.size > 0 && !streamState?.sawAnyTextDelta) {
            const merged = [...buf.parts.entries()]
              .sort((a,b) => a[0]-b[0])
              .map(([,v]) => v)
              .join('');
            if (merged) {
              result.answer += merged;
            }
          }
          if (!streamState?.sawAnyTextDelta) {
            for (const c of item.content) {
              if (c.type === 'output_text') {
                result.answer += c.text;
              }
            }
          }
          onResult?.(result);
          return;
        }
        break;
      }
      case 'response.content_part.done': {
        const part = data.part;
        if (part.type === 'output_text') {
          // Finalize buffered part text
          if (itemBuffers && data.item_id) {
            const rec = itemBuffers.get(data.item_id) || { parts: new Map<number, string>() };
            rec.parts.set(data.content_index, part.text);
            itemBuffers.set(data.item_id, rec);
          }
          if (!streamState?.sawAnyTextDelta) {
            result.answer += part.text;
          }
          onResult?.(result);
          return;
        }
        break;
      }
      case 'response.output_text.delta': {
        if (streamState) streamState.sawAnyTextDelta = true;
        // Append to per-item buffer for this part
        if (itemBuffers && data.item_id) {
          const rec = itemBuffers.get(data.item_id) || { parts: new Map<number, string>() };
          const prev = rec.parts.get(data.content_index) || '';
          rec.parts.set(data.content_index, prev + data.delta);
          itemBuffers.set(data.item_id, rec);
        }
        result.answer += data.delta;
        onResult?.(result);
        return;
      }
      case 'response.output_text.done': {
        const text = data.text ?? data.output_text;
        if (typeof text === 'string' && text.length > 0) {
          result.answer = text;
        }
        onResult?.(result);
        return;
      }
      case 'response.image_generation_call.partial_image': {
        const base64 = data.partial_image_b64;
        result.images = result.images || [];
        result.images.push({ base64, mimeType: 'image/png', provider: this.name, model: this._model });
        onResult?.(result);
        return;
      }
      default:
        // ignore other events; they don't carry text we need
        break;
    }
  }

  private mapImageInput(image: LangImageInput): any {
    const kind: any = (image as any).kind;
    if (kind === 'url') {
      const url = (image as any).url as string;
      return { type: 'input_image', image_url: url };
    }
    if (kind === 'base64') {
      const base64 = (image as any).base64 as string;
      const mimeType = (image as any).mimeType || 'image/png';
      return { type: 'input_image', data: { mime_type: mimeType, data: base64 } };
    }
    throw new Error('Unsupported image kind for Responses mapping');
  }
}