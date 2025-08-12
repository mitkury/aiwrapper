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

    // Build a single text input for Responses API for maximum compatibility
    const input = this.messagesToInputText(messageCollection);

    const stream = typeof options?.onResult === 'function';

    const body: any = {
      model: this._model,
      input,
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
        if (data.finished) {
          result.finished = true;
          options?.onResult?.(result);
          return;
        }
        // Heuristic for Responses streaming
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

  private messagesToInputText(messages: LangChatMessageCollection): string {
    const parts: string[] = [];
    for (const m of messages) {
      const role = m.role;
      const content = (m as any).content;
      if (Array.isArray(content)) {
        // Caller should avoid Responses path when images/structured content present
        // Fallback in OpenAILang
        continue;
      }
      parts.push(`${role}: ${String(content)}`);
    }
    return parts.join("\n\n");
  }
}