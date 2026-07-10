# OpenAI Responses image streaming

The Responses API can stream image generation as typed Server-Sent Events when `stream: true` and the `image_generation` built-in tool are enabled.

## Event flow

The relevant events are:

1. `response.output_item.added` creates an `image_generation_call` output item.
2. `response.image_generation_call.partial_image` may deliver one or more preview images.
3. `response.output_item.done` contains the completed image generation item.
4. `response.completed`, `response.incomplete`, or `response.failed` ends the response.

A partial-image event includes an item ID, output index, partial-image index, and base64 image:

```json
{
  "type": "response.image_generation_call.partial_image",
  "item_id": "item-123",
  "output_index": 0,
  "partial_image_index": 0,
  "partial_image_b64": "..."
}
```

Each partial payload is a complete preview image, not a byte range that must be concatenated. Later indexes represent newer previews.

## Current AIWrapper behavior

`OpenAIResponseStreamHandler` ignores partial previews and stores the final image from `response.output_item.done`. The completed image is exposed through `LangMessages.assistantImages`.

If progressive previews are added later, keep them separate from conversation history:

- key temporary previews by `item_id` and `partial_image_index`;
- emit preview updates without appending a new assistant message for every image;
- release replaced object URLs in browser clients;
- persist only the completed output item.

Provider failures may arrive after partial previews. Treat those previews as temporary and leave the conversation unfinished or failed.

See the [official image generation guide](https://developers.openai.com/api/docs/guides/image-generation) and [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create).
