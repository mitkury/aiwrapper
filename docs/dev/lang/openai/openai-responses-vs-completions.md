### OpenAI Chat Completions vs. Responses (Quick Reference)

- **Endpoints**
  - **Chat Completions**: `POST /v1/chat/completions`
  - **Responses**: `POST /v1/responses` (optionally `?stream=true`)

- **Request shape**
  - **Chat Completions**: pass `messages: [{ role, content }]`. Supports content arrays with `{ type: 'text' | 'image_url' }` for multimodal inputs in compatible providers.
  - **Responses**: pass a unified `input` (string or structured). The older `messages` param is not supported and returns errors like “Unsupported parameter: 'messages' ... moved to 'input'”.

- **Streaming**
  - **Chat Completions**: `stream: true` returns SSE with `choices[].delta` chunks.
  - **Responses**: `stream: true` returns SSE with deltas that can include `output_text` and other output parts.

- **Multimodal and images**
  - **Chat Completions**: generally text output; image generation requires separate Images API. Some proxies may embed image parts as `image_url`.
  - **Responses**: designed to unify modalities (text, image, etc.). When supported by the model, image outputs can appear in the response stream/body as output parts.

- **Tools / structured output**
  - Both support tools/function calling and structured output, but formats differ slightly. Responses leans toward a unified schema for multimodal outputs.

- **Model support**
  - **Chat Completions**: works with legacy and many current chat models.
  - **Responses**: supported by modern models (e.g., `gpt-4o` family, `o1`/`o3`, image-capable models). Legacy chat-only models may not support Responses.

- **Migration tips**
  - Don’t send `messages` to Responses; use `input`.
  - Expect different delta/event shapes on streaming.
  - For image generation, prefer Responses (or the Images API) with models that support it.

- **How this repo uses them**
  - We prefer the Responses API by default for modern OpenAI models and auto-fallback to Chat Completions when the API reports unsupported parameters.
  - Image outputs are surfaced as `LangResult.images` when the provider/model returns them.