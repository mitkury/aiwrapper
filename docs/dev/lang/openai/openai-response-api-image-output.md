## OpenAI Responses API – Streaming Image Output

Reference drill-down for how OpenAI models stream image generations when you call the Responses API with `stream: true`.

### What to Enable

- Call `responses.create` (or the SDK equivalent) with the `stream` flag set.
- Consume the Server-Sent Events feed (`Accept: text/event-stream`) just like we do for text streaming.
- Every event comes typed; the image-specific updates are prefixed with `response.image_generation_call.*`.

### Event Timeline (Happy Path)

1. `response.output_item.added` – an entry for the pending image appears in the response output array.
2. `response.image_generation_call.in_progress` (and optionally `.generating`) – the tool call has started.
3. `response.image_generation_call.partial_image` – repeated event carrying the progressive render.
4. `response.image_generation_call.completed` – the model finished rendering the final image.
5. `response.output_item.done` and `response.content_part.done` – the normal per-item/per-part completion signals fire.
6. `response.completed` (or `response.incomplete`) – the session is done.

### Partial Image Payloads

`response.image_generation_call.partial_image` delivers a JSON object:

```json
{
  "type": "response.image_generation_call.partial_image",
  "item_id": "item-123",
  "output_index": 0,
  "sequence_number": 0,
  "partial_image_index": 0,
  "partial_image_b64": "..."
}
```

- `partial_image_b64` is a base64-encoded PNG or JPEG chunk (OpenAI doc labels it “Base64-encoded partial image data”).
- `partial_image_index` increments per chunk so you can overwrite/merge in order. Treat it like a frame number.
- The event fires until the render completes. Use each chunk to update previews if you want progressive UI feedback.

### Final Image

- Once `response.image_generation_call.completed` arrives, the final image is stabilized.
- The corresponding `response.content_part.done` contains the finished asset in the normal response body (base64 image). If you buffered the partials yourself, you can ignore this and rely on the final chunk; otherwise read the content-part payload for the whole image.

### Failure & Edge Cases

- If generation fails you’ll get `response.image_generation_call.failed` followed by `response.failed`.
- You might still receive some partial chunks before the failure — discard or surface as degraded previews.
- Remember that other tools can run in parallel; always key lookups by `item_id`.

### Minimal Handling Strategy

- Reuse the text-streaming buffer map but store `{ images: Map<number, string> }` for each `item_id`.
- Append/replace the base64 entry on every `partial_image` event keyed by `partial_image_index`.
- Emit/refresh the UI preview with `URL.createObjectURL` + `Blob` constructed from `atob(partial)`. Clear the URL when done.
- On `image_generation_call.completed`, choose the highest `partial_image_index` (latest chunk) to render as the final image.
- On `output_item.done`, persist the final asset (e.g., store to conversation history, upload, etc.).

### Doc Links

- Streaming overview: https://platform.openai.com/docs/guides/streaming-responses
- Streaming events reference: https://platform.openai.com/docs/api-reference/responses-streaming
- Image streaming reference: https://platform.openai.com/docs/api-reference/images-streaming

