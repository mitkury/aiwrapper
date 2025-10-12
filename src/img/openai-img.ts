import { LangImageInput } from "../lang/language-provider.ts";
import { LangMessages } from "../lang/messages.ts";
import { httpRequestWithRetry as fetch } from "../http-request.ts";

export type OpenAIImgOptions = {
  apiKey: string;
  model?: string;
  baseURL?: string;
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
    };

    const response = await fetch(`${this._baseURL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      onError: async (res: Response, error: Error): Promise<void> => {
        if (res.status === 401) { throw new Error('Authentication failed.'); }
        if (res.status === 400) { const data = await res.text(); throw new Error(data); }
      }
    });

    const json: any = await response.json();
    const dataItem = json?.data?.[0];
    if (!dataItem) throw new Error('No image data');

    result.images = result.images || [];
    if (dataItem.b64_json) {
      result.images.push({ base64: dataItem.b64_json, mimeType: 'image/png', provider: 'openai', model: this._model, metadata: { created: json?.created } });
      result.addAssistantMessage('image://base64');
    } else if (dataItem.url) {
      result.images.push({ url: dataItem.url, provider: 'openai', model: this._model, metadata: { created: json?.created } });
      result.addAssistantMessage(dataItem.url);
    }
    result.finished = true;
    return result;
  }

  async edit(params: { prompt: string; image: LangImageInput; mask?: LangImageInput; size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'; n?: number; quality?: 'standard' | 'hd'; responseFormat?: 'url' | 'b64_json' }): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage(`Edit image: ${params.prompt}`);
    const result = messages;

    const form = await this.buildImageEditForm({ model: this._model, ...params });

    const response = await fetch(`${this._baseURL}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this._apiKey}` },
      body: form as any,
      onError: async (res: Response, error: Error): Promise<void> => {
        if (res.status === 401) { throw new Error('Authentication failed.'); }
        if (res.status === 400) { const data = await res.text(); throw new Error(data); }
      }
    });

    const json: any = await response.json();
    const dataItem = json?.data?.[0];
    if (!dataItem) throw new Error('No image data');

    result.images = result.images || [];
    if (dataItem.b64_json) {
      result.images.push({ base64: dataItem.b64_json, mimeType: 'image/png', provider: 'openai', model: this._model, metadata: { created: json?.created } });
      result.addAssistantMessage('image://base64');
    } else if (dataItem.url) {
      result.images.push({ url: dataItem.url, provider: 'openai', model: this._model, metadata: { created: json?.created } });
      result.addAssistantMessage(dataItem.url);
    }
    result.finished = true;
    return result;
  }

  async vary(params: { image: LangImageInput; size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'; n?: number; quality?: 'standard' | 'hd'; responseFormat?: 'url' | 'b64_json' }): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage('Vary image');
    const result = messages;

    const form = await this.buildImageVariationForm({ model: this._model, ...params });

    const response = await fetch(`${this._baseURL}/images/variations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this._apiKey}` },
      body: form as any,
      onError: async (res: Response, error: Error): Promise<void> => {
        if (res.status === 401) { throw new Error('Authentication failed.'); }
        if (res.status === 400) { const data = await res.text(); throw new Error(data); }
      }
    });

    const json: any = await response.json();
    const dataItem = json?.data?.[0];
    if (!dataItem) throw new Error('No image data');

    result.images = result.images || [];
    if (dataItem.b64_json) {
      result.images.push({ base64: dataItem.b64_json, mimeType: 'image/png', provider: 'openai', model: this._model, metadata: { created: json?.created } });
      result.addAssistantMessage('image://base64');
    } else if (dataItem.url) {
      result.images.push({ url: dataItem.url, provider: 'openai', model: this._model, metadata: { created: json?.created } });
      result.addAssistantMessage(dataItem.url);
    }
    result.finished = true;
    return result;
  }

  // Helpers
  private async buildImageEditForm(args: { model: string; prompt: string; image: LangImageInput; mask?: LangImageInput; size?: string; n?: number; quality?: 'standard' | 'hd'; response_format?: 'url' | 'b64_json' }): Promise<FormData> {
    const form = new FormData();
    form.append('model', args.model);
    form.append('prompt', args.prompt);
    const img = await this.imageInputToBlob(args.image);
    form.append('image', img as any, this.blobFilename(img.type));
    if (args.mask) {
      const mask = await this.imageInputToBlob(args.mask);
      if (mask.type !== 'image/png') throw new Error('Mask must be PNG with transparency');
      form.append('mask', mask as any, this.blobFilename(mask.type));
    }
    if (args.size) form.append('size', args.size);
    if (args.n) form.append('n', String(args.n));
    if (args.quality) form.append('quality', args.quality);
    return form;
  }

  private async buildImageVariationForm(args: { model: string; image: LangImageInput; size?: string; n?: number; quality?: 'standard' | 'hd'; response_format?: 'url' | 'b64_json' }): Promise<FormData> {
    const form = new FormData();
    form.append('model', args.model);
    const img = await this.imageInputToBlob(args.image);
    form.append('image', img as any, this.blobFilename(img.type));
    if (args.size) form.append('size', args.size);
    if (args.n) form.append('n', String(args.n));
    if (args.quality) form.append('quality', args.quality);
    return form;
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
    throw new Error('Unknown LangImageInput kind');
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

  private guessMimeFromUrl(url: string): string | undefined {
    const lower = url.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return undefined;
  }
}