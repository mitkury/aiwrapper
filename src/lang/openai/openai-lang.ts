import {
  LangChatMessageCollection,
  LangOptions,
  LangResult,
  LangChatMessage,
  Tool
} from "../language-provider.ts";
import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { 
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch
} from "../../http-request.ts";
import { OpenAIResponsesLang } from "./openai-responses-lang.ts";
import { LangImageInput } from "../language-provider.ts";

export type OpenAILangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export type OpenAILangConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
};

export type OpenAIChatMessage = {
  role: "developer" | "user" | "assistant";
  content: string;
};

export class OpenAILang extends OpenAILikeLang {
  private _responses?: OpenAIResponsesLang;
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-4o";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.openai.com/v1",
    });
    
    if (!this.modelInfo) {
      console.error(`Invalid OpenAI model: ${modelName}. Model not found in aimodels database.`);
    }

    this._responses = new OpenAIResponsesLang({ apiKey: options.apiKey, model: modelName, systemPrompt: options.systemPrompt });
  }

  // Expose generateImage from base class
  async generateImage(prompt: string, options?: any) {
    return super.generateImage(prompt, options);
  }

  /**
   * Edit an existing image using OpenAI Images Edit API.
   */
  async editImage(params: {
    prompt: string;
    image: LangImageInput;
    mask?: LangImageInput;
    size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
    n?: number;
    quality?: "standard" | "hd";
    responseFormat?: "url" | "b64_json";
  }): Promise<LangResult> {
    const messages = new LangChatMessageCollection();
    messages.addUserMessage(`Edit image: ${params.prompt}`);
    const result = new LangResult(messages);

    const modelForImages = /image|dall-e/i.test(this.name) ? this.name : "gpt-image-1";

    const form = await this.buildImageEditForm({
      model: modelForImages,
      prompt: params.prompt,
      image: params.image,
      mask: params.mask,
      size: params.size,
      n: params.n,
      quality: params.quality,
      response_format: params.responseFormat,
    });

    const response = await fetch(`${this._config.baseURL}/images/edits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._config.apiKey}`,
        ...this._config.headers,
      },
      body: form as any,
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
    });

    const json: any = await response.json();
    const dataItem = json?.data?.[0];

    if (!dataItem) {
      throw new Error("Image edit returned no data");
    }

    result.images = result.images || [];
    if (dataItem.b64_json) {
      result.images.push({ base64: dataItem.b64_json, mimeType: "image/png", provider: this.name, model: modelForImages, metadata: { created: json?.created } });
      result.answer = "image://base64";
    } else if (dataItem.url) {
      result.images.push({ url: dataItem.url, provider: this.name, model: modelForImages, metadata: { created: json?.created } });
      result.answer = dataItem.url;
    }

    result.finished = true;
    return result;
  }

  /**
   * Create variations of an image using OpenAI Images Variations API.
   */
  async varyImage(params: {
    image: LangImageInput;
    size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
    n?: number;
    quality?: "standard" | "hd";
    responseFormat?: "url" | "b64_json";
  }): Promise<LangResult> {
    const messages = new LangChatMessageCollection();
    messages.addUserMessage(`Vary image`);
    const result = new LangResult(messages);

    const modelForImages = /image|dall-e/i.test(this.name) ? this.name : "gpt-image-1";

    const form = await this.buildImageVariationForm({
      model: modelForImages,
      image: params.image,
      size: params.size,
      n: params.n,
      quality: params.quality,
      response_format: params.responseFormat,
    });

    const response = await fetch(`${this._config.baseURL}/images/variations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._config.apiKey}`,
        ...this._config.headers,
      },
      body: form as any,
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
    });

    const json: any = await response.json();
    const dataItem = json?.data?.[0];

    if (!dataItem) {
      throw new Error("Image variation returned no data");
    }

    result.images = result.images || [];
    if (dataItem.b64_json) {
      result.images.push({ base64: dataItem.b64_json, mimeType: "image/png", provider: this.name, model: modelForImages, metadata: { created: json?.created } });
      result.answer = "image://base64";
    } else if (dataItem.url) {
      result.images.push({ url: dataItem.url, provider: this.name, model: modelForImages, metadata: { created: json?.created } });
      result.answer = dataItem.url;
    }

    result.finished = true;
    return result;
  }

  private async buildImageEditForm(args: {
    model: string;
    prompt: string;
    image: LangImageInput;
    mask?: LangImageInput;
    size?: string;
    n?: number;
    quality?: "standard" | "hd";
    response_format?: "url" | "b64_json";
  }): Promise<FormData> {
    const form = new FormData();
    form.append("model", args.model);
    form.append("prompt", args.prompt);

    const imageBlob = await this.imageInputToBlob(args.image);
    form.append("image", imageBlob as any, this.blobFilename(imageBlob.type));

    if (args.mask) {
      const maskBlob = await this.imageInputToBlob(args.mask);
      if (maskBlob.type !== "image/png") {
        throw new Error("Mask must be a PNG with transparency for editable regions");
      }
      form.append("mask", maskBlob as any, this.blobFilename(maskBlob.type));
    }

    if (args.size) form.append("size", args.size);
    if (args.n) form.append("n", String(args.n));
    if (args.quality) form.append("quality", args.quality);
    if (args.response_format) form.append("response_format", args.response_format);

    return form;
  }

  private async buildImageVariationForm(args: {
    model: string;
    image: LangImageInput;
    size?: string;
    n?: number;
    quality?: "standard" | "hd";
    response_format?: "url" | "b64_json";
  }): Promise<FormData> {
    const form = new FormData();
    form.append("model", args.model);

    const imageBlob = await this.imageInputToBlob(args.image);
    form.append("image", imageBlob as any, this.blobFilename(imageBlob.type));

    if (args.size) form.append("size", args.size);
    if (args.n) form.append("n", String(args.n));
    if (args.quality) form.append("quality", args.quality);
    if (args.response_format) form.append("response_format", args.response_format);

    return form;
  }

  private blobFilename(mime: string): string {
    switch (mime) {
      case "image/png": return "image.png";
      case "image/jpeg": return "image.jpg";
      case "image/webp": return "image.webp";
      case "image/gif": return "image.gif";
      default: return "image.bin";
    }
  }

  private async imageInputToBlob(image: LangImageInput): Promise<Blob> {
    const kind: any = (image as any).kind;
    if (kind === 'url') {
      const url = (image as any).url as string;
      const res = await fetch(url, { method: 'GET' } as any);
      const arrayBuffer = await res.arrayBuffer();
      const contentType = (res as any).headers?.get?.('content-type') || this.guessMimeFromUrl(url) || 'image/png';
      return new Blob([arrayBuffer], { type: contentType });
    }
    if (kind === 'base64') {
      const base64 = (image as any).base64 as string;
      const mimeType = (image as any).mimeType || 'image/png';
      const buf = Buffer.from(base64, 'base64');
      return new Blob([buf], { type: mimeType });
    }
    if (kind === 'bytes') {
      const bytes = (image as any).bytes as ArrayBuffer | Uint8Array;
      const mimeType = (image as any).mimeType || 'application/octet-stream';
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return new Blob([arr], { type: mimeType });
    }
    if (kind === 'blob') {
      const blob = (image as any).blob as Blob;
      const mimeType = (image as any).mimeType || (blob as any).type || 'application/octet-stream';
      return mimeType && mimeType !== (blob as any).type ? new Blob([await blob.arrayBuffer()], { type: mimeType }) : blob;
    }
    throw new Error("Unknown LangImageInput kind");
  }

  private guessMimeFromUrl(url: string): string | undefined {
    const lower = url.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return undefined;
  }

  private isResponsesPreferred(model: string): boolean {
    return /^(gpt-4o|o1|o3|gpt-image-1)/i.test(model);
  }

  override async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult> {
    if (this._responses && this.isResponsesPreferred(this.name)) {
      try {
        return await this._responses.chat(messages, options);
      } catch (err: any) {
        if (String(err?.message || '').includes("Unsupported parameter") || String(err?.message || '').includes("invalid_request_error")) {
          return super.chat(messages as any, options);
        }
        throw err;
      }
    }
    return super.chat(messages as any, options);
  }

  protected override transformBody(body: Record<string, unknown>): Record<string, unknown> {
    const transformedBody = super.transformBody(body);
    if (transformedBody.max_tokens) {
      const { max_tokens, ...rest } = transformedBody;
      return { ...rest, max_completion_tokens: max_tokens };
    }
    return transformedBody;
  }
  
  protected override handleStreamData(
    data: any, 
    result: LangResult,
    messages: LangChatMessageCollection,
    onResult?: (result: LangResult) => void,
    toolArgBuffers?: Map<string, { name: string; buffer: string }>
  ): void {
    super.handleStreamData(data, result, messages, onResult, toolArgBuffers);
  }
  
  protected override formatTools(tools: Tool[]): any[] {
    return super.formatTools(tools);
  }
}
