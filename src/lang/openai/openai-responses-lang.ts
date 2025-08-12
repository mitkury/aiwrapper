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

    // Map generic messages into Responses API messages format (OpenAI-compatible content parts)
    const providerMessages = this.transformMessages(messageCollection);

    // If image output requested, include image in modalities
    const wantsImageOutput = options?.imageOutput && options.imageOutput !== "auto";

    const body: any = {
      model: this._model,
      messages: providerMessages,
      ...(wantsImageOutput ? { modalities: ["text", "image"] } : {}),
    };

    const response = await fetch(`${this._baseURL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      onNotOkResponse: async (res, decision): Promise<DecisionOnNotOkResponse> => {
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
    });

    const data: any = await response.json();

    // Heuristic parse: try Responses API shapes
    // Prefer structured output arrays
    const outputs = (data?.output || data?.response?.output || data?.content || []);

    const appendAssistantText = (text: string) => {
      result.answer += text;
      if (result.messages.length > 0 && result.messages[result.messages.length - 1].role === 'assistant') {
        result.messages[result.messages.length - 1].content = result.answer;
      } else {
        result.messages.push({ role: 'assistant', content: result.answer });
      }
    };

    const tryExtractFromContent = (contentItem: any) => {
      // Common variants
      if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
        appendAssistantText(contentItem.text);
      }
      if (contentItem?.type === 'text' && typeof contentItem.text === 'string') {
        appendAssistantText(contentItem.text);
      }
      // Image outputs
      if (contentItem?.type === 'output_image') {
        if (contentItem.image_url) {
          result.images = result.images || [];
          result.images.push({ url: contentItem.image_url, provider: this.name, model: this._model });
        }
        if (contentItem.b64_json || contentItem.base64 || contentItem.data) {
          const base64 = contentItem.b64_json || contentItem.base64 || contentItem.data;
          const mimeType = contentItem.mime_type || contentItem.mimeType || 'image/png';
          result.images = result.images || [];
          result.images.push({ base64, mimeType, provider: this.name, model: this._model });
        }
      }
      if (contentItem?.type === 'image_url' && contentItem.image_url?.url) {
        result.images = result.images || [];
        result.images.push({ url: contentItem.image_url.url, provider: this.name, model: this._model });
      }
    };

    // Parse different possible containers
    if (Array.isArray(outputs)) {
      for (const item of outputs) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) tryExtractFromContent(c);
        } else if (Array.isArray(item)) {
          for (const c of item) tryExtractFromContent(c);
        } else {
          tryExtractFromContent(item);
        }
      }
    } else if (Array.isArray(data?.message?.content)) {
      for (const c of data.message.content) tryExtractFromContent(c);
    } else if (Array.isArray(data?.choices?.[0]?.message?.content)) {
      for (const c of data.choices[0].message.content) tryExtractFromContent(c);
    } else if (typeof data?.output_text === 'string') {
      appendAssistantText(data.output_text);
    }

    result.finished = true;
    return result;
  }

  private transformMessages(messages: LangChatMessageCollection): any[] {
    return messages.map((msg: any) => {
      const content = msg.content as any;
      if (Array.isArray(content)) {
        return { role: msg.role === 'assistant' ? 'assistant' : msg.role, content: this.mapParts(content as LangContentPart[]) };
      }
      return { role: msg.role === 'assistant' ? 'assistant' : msg.role, content: [{ type: 'text', text: String(content) }] };
    });
  }

  private mapParts(parts: LangContentPart[]): any[] {
    const out: any[] = [];
    for (const p of parts) {
      if (p.type === 'text') {
        out.push({ type: 'text', text: p.text });
      } else if (p.type === 'image') {
        out.push(this.mapImage(p.image));
      }
    }
    return out;
  }

  private mapImage(image: LangImageInput): any {
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
    throw new Error("Unsupported image kind for Responses mapping. Use url or base64.");
  }
}