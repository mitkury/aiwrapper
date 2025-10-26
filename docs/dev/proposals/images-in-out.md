# AIWrapper Images In/Out Proposal

- Date: 2025-05-11
- Status: Proposal

## Overview
Add first-class support for image inputs and image outputs in `Lang` so applications can:
- Attach images to prompts/messages (vision input)
- Receive images from models that can generate them (image output)

This proposal defines a provider-agnostic message/content shape, standard image formats (URL, base64, data URL, Blob/ArrayBuffer), and provider-specific mappings for OpenAI, Anthropic, Google (Gemini), Groq/OpenRouter, Mistral, Ollama, xAI, and DeepSeek.

## Goals
- Support images as message content alongside text
- Normalize common image input formats (URL, base64, data URL, Blob/ArrayBuffer)
- Capture image outputs in `LangResult` where providers/models support it
- Streaming-friendly updates: emit `onResult` when image parts arrive
- Keep text-only APIs working unchanged

## Non-goals
- Implement full asset upload lifecycles for providers that require separate file APIs
- Add separate, dedicated Image Generation API (may come later; here we focus on doing it within Lang if the model supports it)

## API Changes

### New types

```ts
// New: normalized image union accepted by Lang
export type LangImageInput =
  | { kind: "url"; url: string } // remote URL or data URL
  | { kind: "base64"; base64: string; mimeType?: string }
  | { kind: "bytes"; bytes: ArrayBuffer | Uint8Array; mimeType?: string }
  | { kind: "blob"; blob: Blob; mimeType?: string };

// New: image output representation
export type LangImageOutput = {
  // Either a URL, a data URL, or base64 data
  url?: string;           // remote or data URL
  base64?: string;        // raw base64 (no data URL prefix)
  mimeType?: string;      // e.g. image/png
  width?: number;
  height?: number;
  // Optional provider hints for debugging/auditing
  provider?: string;      // e.g. "openai"
  model?: string;         // model name
  metadata?: Record<string, unknown>;
};

// New: content parts for messages
export type LangContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: LangImageInput; alt?: string };
```

### Message content shape
- Extend `LangChatMessage.content` from `string | any` to support structured parts:
  - `string` (existing): unchanged
  - `LangContentPart[]`: a mixed list of text and image parts

No breaking change: existing code that passes `string` continues to work.

### Helpers
Add convenience helpers to `LangChatMessageCollection`:

```ts
addUserContent(parts: LangContentPart[]): this;
addUserImage(image: LangImageInput, alt?: string): this;
addAssistantContent(parts: LangContentPart[]): this;
```

### Output container
Add images to `LangResult`:

```ts
class LangResult {
  images?: LangImageOutput[]; // collected images from assistant output
}
```

When streaming, `images` is appended as images arrive; `onResult` is called each time it changes.

### Options
Extend `LangOptions` (optional, provider-agnostic hints):

```ts
interface LangOptions {
  // Preferred output format when the model can return images
  imageOutput?: "auto" | "url" | "base64"; // default: "auto"

  // Optional hook to transform local binary -> URL (for providers needing URLs)
  // If provided, the provider adapter can call it to upload and get a URL
  // e.g., to your own CDN or storage.
  uploadImage?: (input: { data: ArrayBuffer; mimeType?: string }) => Promise<{ url: string }>;
}
```

Providers MAY ignore these if not applicable.

## Provider mappings
Below are the recommended mappings for each provider. The adapter should gracefully ignore image parts if the selected model does not support vision input/output.

### OpenAI (Chat Completions / Responses)
- Input mapping (chat/completions):
  - For `LangContentPart.type === "text"`: map to `{ type: "text", text }`
  - For `LangContentPart.type === "image"`:
    - `kind: "url"` with `url` possibly remote or `data:` URL: map to `{ type: "image_url", image_url: { url } }`
    - `kind: "base64"` or `bytes`/`blob`: transform to a `data:` URL if possible and map as above. Alternatively, for providers that support `input_image` with raw base64, use `{ type: "input_image", b64, mime_type }` when available.
- Output mapping:
  - If using a model that can produce images via the Responses API (e.g., `gpt-image-1` or future multimodal outputs), detect image parts in streamed response: entries with `type` like `output_image`/`image_url`/`inline_data` and push into `result.images` as `LangImageOutput`.
  - For chat/completions (classic) most models do not return images. If image output is requested and a known image-generation model is used, the adapter MAY switch to the Responses API path internally. This can be gated by `options.imageOutput`.

### Anthropic (Messages API)
- Input mapping:
  - Map to Anthropic message `content` blocks:
    - Text: `{ type: "text", text }`
    - Image: `{ type: "image", source: { type: "base64", media_type: mime, data: base64 } }`
  - For URL images, fetch or use `uploadImage` to obtain base64; Anthropic generally requires base64 inline.
- Output: Anthropic does not currently emit image content. `result.images` remains empty.

### Google Gemini (Generative Language)
- Input mapping:
  - Message `parts` array per content item:
    - Text: `{ text }`
    - Base64/bytes/blob: `{ inlineData: { mimeType, data: base64 } }`
    - URL: if remote URL is necessary, user should pre-upload. Otherwise, try to fetch and convert to inlineData (or use `uploadImage`).
- Output mapping:
  - Some models can return images as `inlineData` or `fileData`. When detected in streamed `parts`, convert to `LangImageOutput`:
    - `inlineData` -> `{ base64, mimeType }`
    - `fileData` -> `{ url: fileUri }`

### Groq / OpenRouter / DeepSeek / xAI (OpenAI-like)
- Input mapping: same as OpenAI chat/completions image parts (`image_url` or `input_image` where supported).
- Output mapping: typically text-only; if a proxied model returns image parts, map them to `LangImageOutput`.

### Mistral
- Input mapping: use OpenAI-like `content` array with `{ type: "image_url", image_url: { url } }` for URL/data-URL; for base64/bytes/blob, convert to `data:` URL if needed.
- Output mapping: text-only for most chat models; ignore otherwise.

### Ollama
- Input mapping:
  - `generate` endpoint supports `images: [ base64 ]` for vision models; collect all image parts and provide base64 strings.
  - `chat` endpoint: recent versions accept images alongside messages for vision models; where unsupported, fallback to `generate` for single-turn.
- Output mapping: chat/generate are text-only; ignore image output.

## Image input normalization
The provider adapters should normalize inputs as follows:
- If `kind: "url"` and `url` is a `data:` URL, pass through where supported; otherwise convert to base64 + mime
- If `kind: "base64"`, pass through with provided `mimeType` if needed
- If `kind: "bytes"` or `kind: "blob"`, convert to base64 and set `mimeType` when available
- If provider requires URL (rare), call `options.uploadImage` if provided; otherwise throw a clear error

Supported MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/gif`. Adapters should pass through unknown but declared types.

## Streaming behavior
- When a streamed delta includes an image part, append to `result.images` and call `onResult` immediately.
- If the provider streams image bytes in chunks (rare), buffer until complete before emitting.
- Text deltas continue to update `result.answer` as today.

## Backward compatibility
- Existing `string` content remains supported and unchanged
- Providers that do not support vision simply ignore image parts (or throw a clear error if the model claims vision but rejects the request)

## Examples

### Send an image and text in one user message
```ts
const messages = new LangChatMessageCollection()
  .addUserContent([
    { type: "text", text: "What is shown in this photo?" },
    { type: "image", image: { kind: "url", url: "https://example.com/cat.jpg" } }
  ]);

const res = await lang.chat(messages);
console.log(res.answer);
```

### Send base64 image
```ts
const base64 = await readFileAsBase64("/path/photo.png");
const messages = new LangChatMessageCollection()
  .addUserContent([
    { type: "text", text: "Count objects" },
    { type: "image", image: { kind: "base64", base64, mimeType: "image/png" } }
  ]);

const res = await lang.chat(messages);
```

### Receive images back
```ts
const res = await lang.ask("Create a 256x256 red square", { imageOutput: "base64" });
if (res.images?.length) {
  const img = res.images[0];
  // img.base64 + img.mimeType available
}
```

## Implementation plan
1. Core types and helpers
   - Add `LangImageInput`, `LangImageOutput`, `LangContentPart`
   - Extend `LangChatMessage` to allow `LangContentPart[]`
   - Add `LangResult.images?: LangImageOutput[]`
   - Add helpers to `LangChatMessageCollection`
   - Extend `LangOptions` with `imageOutput?` and `uploadImage?`
2. Provider adapters
   - OpenAI / OpenAI-like: map text/image parts to `content` array; parse output parts for images if present; optionally support Responses API for image-generation models
   - Anthropic: convert images to base64 blocks
   - Google: map to `parts` with `inlineData`
   - Mistral: OpenAI-like mapping
   - Groq/OpenRouter/DeepSeek/xAI: OpenAI-like mapping
   - Ollama: supply `images` array on `generate`/`chat`
3. Streaming
   - Update streaming parsers to detect and surface image parts to `LangResult.images`
4. Tests
   - Unit tests for normalization of inputs
   - Provider mapping tests (shape-to-shape) using mocks
   - Streaming tests for partial text + image detection
5. Docs & examples
   - Add examples to `docs/examples` for vision input/output

## Open questions
- OpenAI image output: unify on Chat Completions vs Responses API? Proposal: stay with Chat Completions by default; enable Responses path only for known image-output models or when `imageOutput` is set.
- Upload strategy: provide a default `uploadImage` implementation for Node (buffer -> data URL)? Keep as user-provided for remote URL-only providers.
- Limits: do we enforce per-provider size limits (e.g. 20MB) in adapters, or let server errors surface?