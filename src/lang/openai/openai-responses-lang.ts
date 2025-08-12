import {
  LangChatMessageCollection,
  LangChatMessage,
  LangOptions,
  LangResult,
  LanguageProvider,
  LangContentPart,
  LangImageInput
} from "../language-provider.ts";
import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";

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
    const modelName = options.model || "gpt-4o";
    super(modelName);
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangResult> {
    const messages = new LangChatMessageCollection();
    if (this._systemPrompt) {
      messages.push({ role: "system", content: this._systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    return this.chat(messages, options);
  }

  async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult> {
    const messageCollection = messages instanceof LangChatMessageCollection
      ? messages
      : new LangChatMessageCollection(...messages);

    const result = new LangResult(messageCollection);

    // Build structured input for Responses API
    const input = this.transformMessagesToResponsesInput(messageCollection);

    const stream = typeof options?.onResult === 'function';

    const body: any = {
      model: this._model,
      input,
      modalities: ["text"],
      max_output_tokens: typeof (options as any)?.maxTokens === 'number' ? (options as any).maxTokens : 512,
      ...(stream ? { stream: true } : {}),
    };

    const url = `${this._baseURL}/responses${stream ? '?stream=true' : ''}`;

    const common = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._apiKey}`,
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

      const onData = (data: any) => {
        if (data.finished || data.type === 'response.completed') {
          result.finished = true;
          options?.onResult?.(result);
          return;
        }
        // Handle typed events
        if (typeof data?.type === 'string') {
          if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') {
            result.answer += data.delta;
            options?.onResult?.(result);
            return;
          }
          if (data.type === 'response.output_text.done' && typeof data.output_text === 'string') {
            // finalize segment
            options?.onResult?.(result);
            return;
          }
        }
        // Fallback heuristic
        const textDelta = data?.delta?.output_text || data?.output_text || data?.content?.[0]?.text;
        if (typeof textDelta === 'string') {
          result.answer += textDelta;
        }
        options?.onResult?.(result);
      };

      await processResponseStream(response, onData);
      return result;
    }

    // Non-streaming
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
    const input: any[] = [];
    for (const m of messages) {
      const entry: any = { role: m.role === 'assistant' ? 'assistant' : m.role, content: [] as any[] };
      const content = (m as any).content;
      if (Array.isArray(content)) {
        for (const part of content as LangContentPart[]) {
          if (part.type === 'text') {
            entry.content.push({ type: 'input_text', text: part.text });
          } else if (part.type === 'image') {
            const mapped = this.mapImageInput(part.image);
            entry.content.push(mapped);
          }
        }
      } else {
        entry.content.push({ type: 'input_text', text: String(content) });
      }
      input.push(entry);
    }
    return input;
  }

  private mapImageInput(image: LangImageInput): any {
    const kind: any = (image as any).kind;
    if (kind === 'url') {
      const url = (image as any).url as string;
      return { type: 'image_url', image_url: { url } };
    }
    if (kind === 'base64') {
      const base64 = (image as any).base64 as string;
      const mimeType = (image as any).mimeType || 'image/png';
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return { type: 'image_url', image_url: { url: dataUrl } };
    }
    throw new Error('Unsupported image kind for Responses mapping');
  }
}