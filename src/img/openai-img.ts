import type { LangImageInput } from "../lang/language-provider.js";
import { LangMessages } from "../lang/messages.js";
import { httpRequestWithRetry as fetch } from "../http-request.js";

export type OpenAIImgOptions = {
  apiKey: string;
  model?: string;
  baseURL?: string;
};

type OpenAIImageData = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  output_format?: string;
  mime_type?: string;
};

export class OpenAIImg {
  private _apiKey: string;
  private _model: string;
  private _baseURL: string;

  constructor(options: OpenAIImgOptions) {
    this._apiKey = options.apiKey;
    this._model = options.model || 'gpt-image-1';
    this._baseURL = options.baseURL || 'https://api.openai.com/v1';
  }

  async generate(prompt: string, options?: { size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'; quality?: 'standard' | 'hd'; responseFormat?: 'url' | 'b64_json' }): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage(`Generate image: ${prompt}`);
    const result = messages;

    const body: Record<string, unknown> = {
      model: this._model,
      prompt,
      n: 1,
      ...(options?.size ? { size: options.size } : {}),
      ...(options?.quality ? { quality: options.quality } : {}),
      ...(options?.responseFormat ? { response_format: options.responseFormat } : {}),
    };

    const response = await fetch(`${this._baseURL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const json = await response.json() as { data?: OpenAIImageData[] };
    return this.applyImageResponse(result, json.data);
  }

  async edit(params: { prompt: string; image: LangImageInput; mask?: LangImageInput; size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'; n?: number; quality?: 'standard' | 'hd'; responseFormat?: 'url' | 'b64_json' }): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage(`Edit image: ${params.prompt}`);
    const result = messages;

    const form = await this.buildImageEditForm({
      model: this._model,
      prompt: params.prompt,
      image: params.image,
      mask: params.mask,
      size: params.size,
      n: params.n,
      quality: params.quality,
      response_format: params.responseFormat,
    });

    const response = await fetch(`${this._baseURL}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this._apiKey}` },
      body: form,
    });

    const json = await response.json() as { data?: OpenAIImageData[] };
    return this.applyImageResponse(result, json.data);
  }

  async vary(params: { image: LangImageInput; size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'; n?: number; quality?: 'standard' | 'hd'; responseFormat?: 'url' | 'b64_json' }): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage('Vary image');
    const result = messages;

    const form = await this.buildImageVariationForm({
      model: this._model,
      image: params.image,
      size: params.size,
      n: params.n,
      quality: params.quality,
      response_format: params.responseFormat,
    });

    const response = await fetch(`${this._baseURL}/images/variations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this._apiKey}` },
      body: form,
    });

    const json = await response.json() as { data?: OpenAIImageData[] };
    return this.applyImageResponse(result, json.data);
  }

  private applyImageResponse(
    result: LangMessages,
    data: OpenAIImageData[] | undefined,
  ): LangMessages {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('No image data');
    }

    const items = data.map(item => {
      const metadata = item.revised_prompt
        ? { revisedPrompt: item.revised_prompt }
        : undefined;

      if (item.b64_json) {
        const format = item.mime_type || item.output_format || 'png';
        const mimeType = format.includes('/') ? format : `image/${format}`;
        return {
          type: 'image' as const,
          base64: item.b64_json,
          mimeType,
          metadata,
        };
      }

      if (item.url) {
        return {
          type: 'image' as const,
          url: item.url,
          metadata,
        };
      }

      throw new Error('Image response is missing both b64_json and url');
    });

    result.addAssistantItems(items);
    result.finished = true;
    return result;
  }

  private async buildImageEditForm(args: { model: string; prompt: string; image: LangImageInput; mask?: LangImageInput; size?: string; n?: number; quality?: 'standard' | 'hd'; response_format?: 'url' | 'b64_json' }): Promise<FormData> {
    const form = new FormData();
    form.append('model', args.model);
    form.append('prompt', args.prompt);
    const img = await this.imageInputToBlob(args.image);
    form.append('image', img, this.blobFilename(img.type));
    if (args.mask) {
      const mask = await this.imageInputToBlob(args.mask);
      if (mask.type !== 'image/png') throw new Error('Mask must be PNG with transparency');
      form.append('mask', mask, this.blobFilename(mask.type));
    }
    if (args.size) form.append('size', args.size);
    if (args.n) form.append('n', String(args.n));
    if (args.quality) form.append('quality', args.quality);
    if (args.response_format) form.append('response_format', args.response_format);
    return form;
  }

  private async buildImageVariationForm(args: { model: string; image: LangImageInput; size?: string; n?: number; quality?: 'standard' | 'hd'; response_format?: 'url' | 'b64_json' }): Promise<FormData> {
    const form = new FormData();
    form.append('model', args.model);
    const img = await this.imageInputToBlob(args.image);
    form.append('image', img, this.blobFilename(img.type));
    if (args.size) form.append('size', args.size);
    if (args.n) form.append('n', String(args.n));
    if (args.quality) form.append('quality', args.quality);
    if (args.response_format) form.append('response_format', args.response_format);
    return form;
  }

  private async imageInputToBlob(image: LangImageInput): Promise<Blob> {
    switch (image.kind) {
      case 'url': {
        const response = await fetch(image.url, { method: 'GET' });
        const contentType = response.headers.get('content-type')
          || this.guessMimeFromUrl(image.url)
          || 'image/png';
        return new Blob([await response.arrayBuffer()], { type: contentType });
      }
      case 'base64':
        return new Blob([this.decodeBase64(image.base64)], {
          type: image.mimeType || 'image/png',
        });
      case 'bytes': {
        const source = image.bytes instanceof Uint8Array
          ? image.bytes
          : new Uint8Array(image.bytes);
        const bytes = new Uint8Array(source.byteLength);
        bytes.set(source);
        return new Blob([bytes], {
          type: image.mimeType || 'application/octet-stream',
        });
      }
      case 'blob': {
        const mimeType = image.mimeType
          || image.blob.type
          || 'application/octet-stream';
        return mimeType === image.blob.type
          ? image.blob
          : new Blob([image.blob], { type: mimeType });
      }
    }
  }

  private blobFilename(mime: string): string {
    switch (mime) {
      case 'image/png': return 'image.png';
      case 'image/jpeg': return 'image.jpg';
      case 'image/webp': return 'image.webp';
      case 'image/gif': return 'image.gif';
      default: return 'image.bin';
    }
  }

  private decodeBase64(base64: string): ArrayBuffer {
    const bufferConstructor = (globalThis as any).Buffer;
    if (bufferConstructor) {
      const source = new Uint8Array(bufferConstructor.from(base64, 'base64'));
      const copy = new Uint8Array(source.length);
      copy.set(source);
      return copy.buffer;
    }

    if (typeof globalThis.atob === 'function') {
      const binary = globalThis.atob(base64);
      return Uint8Array.from(
        binary,
        character => character.charCodeAt(0),
      ).buffer;
    }

    throw new Error('This environment cannot decode base64 image data.');
  }

  private guessMimeFromUrl(url: string): string | undefined {
    const lower = url.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return undefined;
  }
}
