import {
  LangOptions,
  LanguageProvider,
  LangMessage,
} from "../language-provider.ts";
import {
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models, Model } from 'aimodels';
import { LangContentPart, LangImageInput } from "../language-provider.ts";
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { LangMessages, LangToolWithHandler } from "../messages.ts";

export type GoogleLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class GoogleLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _maxTokens?: number;
  private modelInfo?: Model;

  constructor(options: GoogleLangOptions) {
    const modelName = options.model || "gemini-2.0-flash";
    super(modelName);

    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Google model: ${modelName}. Model not found in aimodels database.`);
    }

    this.modelInfo = modelInfo;
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
    this._maxTokens = options.maxTokens;
  }

  async ask(
    prompt: string,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messages = new LangMessages();
    if (this._systemPrompt) {
      messages.push({
        role: "user" as "user",
        content: this._systemPrompt,
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
    const result = messageCollection;

    const contents = this.transformMessagesForProvider(messageCollection as any);

    let maxOutputTokens = this._maxTokens;
    if (this.modelInfo && !maxOutputTokens) {
      maxOutputTokens = calculateModelResponseTokens(
        this.modelInfo,
        messageCollection,
        this._maxTokens
      );
    }

    let tools: any | undefined;
    if (messageCollection.availableTools && Array.isArray(messageCollection.availableTools)) {
      const arr = messageCollection.availableTools as LangToolWithHandler[];
      tools = {
        functionDeclarations: arr.map((t) => ({
          name: t.name,
          description: t.description || "",
          parameters: t.parameters,
        })),
      };
    }

    const requestBody: any = {
      contents,
      generationConfig: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
      },
      ...(tools ? { tools } : {}),
    };

    const onResult = options?.onResult;
    const onData = (data: any) => {
      if (data.finished) {
        result.finished = true;
        (options?.onResult as any)?.(result);
        return;
      }

      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      for (const p of parts) {
        if (p.text) {
          result.answer += p.text;
        }
        if (p.inlineData && (p.inlineData.data || p.inlineData.b64_json)) {
          const base64 = p.inlineData.data || p.inlineData.b64_json;
          const mimeType = p.inlineData.mimeType || 'image/png';
          result.images = result.images || [];
          result.images.push({ base64, mimeType, provider: this.name, model: this._model });
        }
        if (p.fileData && p.fileData.fileUri) {
          result.images = result.images || [];
          result.images.push({ url: p.fileData.fileUri, provider: this.name, model: this._model });
        }
        if (p.functionCall) {
          const { name, args } = p.functionCall;
          result.addAssistantToolCalls([{ callId: name, name, arguments: args || {} }]);
        }
      }

      if (result.answer) {
        result.addAssistantMessage(result.answer);
      }

      (options?.onResult as any)?.(result);
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:streamGenerateContent?alt=sse&key=${this._apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        onError: async (res: Response, error: Error): Promise<void> => {
          if (res.status === 401) {
            throw new Error(
              "API key is invalid. Please check your API key and try again.",
            );
          }

          if (res.status === 400) {
            const data = await res.text();
            throw new Error(data);
          }

          // For other errors, let the default retry behavior handle it
        },
      },
    ).catch((err) => {
      throw new Error(err);
    });

    await processResponseStream(response, onData);

    // Automatically execute tools if the assistant requested them
    await result.executeRequestedTools();

    return result;
  }

  protected transformMessagesForProvider(messages: LangMessages): any[] {
    return messages.map((msg: any) => {
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        return {
          role: 'user',
          parts: msg.content.map((tr: any) => ({
            functionResponse: {
              name: tr.toolId,
              response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result }
            }
          }))
        };
      }
      const contentAny = msg.content as any;
      if (Array.isArray(contentAny)) {
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: this.mapPartsToGemini(contentAny as LangContentPart[])
        };
      }
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      };
    });
  }

  private mapPartsToGemini(parts: LangContentPart[]): any[] {
    const out: any[] = [];
    for (const p of parts) {
      if (p.type === 'text') {
        out.push({ text: p.text });
      } else if (p.type === 'image') {
        const inlineData = this.imageInputToGeminiInlineData(p.image);
        out.push({ inlineData });
      }
    }
    return out;
  }

  private imageInputToGeminiInlineData(image: LangImageInput): { mimeType: string; data: string } {
    const kind: any = (image as any).kind;
    if (kind === 'base64') {
      const base64 = (image as any).base64 as string;
      const mimeType = (image as any).mimeType || 'image/png';
      return { mimeType, data: base64 };
    }
    if (kind === 'url') {
      const url = (image as any).url as string;
      if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) throw new Error('Invalid data URL for Gemini image');
        const mimeType = match[1];
        const data = match[2];
        return { mimeType, data };
      }
      throw new Error("Gemini inline image requires base64 or data URL. Provide base64+mimeType or a data: URL.");
    }
    if (kind === 'bytes' || kind === 'blob') {
      throw new Error("Gemini image input requires base64. Convert bytes/blob to base64 first.");
    }
    throw new Error('Unknown image input kind for Gemini');
  }
} 