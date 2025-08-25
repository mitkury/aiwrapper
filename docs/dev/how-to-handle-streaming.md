## How to handle streaming (OpenAI Responses API)

This note explains a simple, robust way to consume Server-Sent Events (SSE) from the OpenAI Responses API and build a coherent answer while supporting interleaved/parallel outputs.

### Key ideas

- Multiple outputs can be produced concurrently (e.g., reasoning + message, or multiple messages). Events can interleave.
- Route updates using identifiers provided in events:
  - item_id: identifies the output item (e.g., one assistant message)
  - content_index: which part inside the item
  - output_index: the item’s index in the response output array
- Maintain per-item buffers keyed by item_id and per-part content_index.

### Event types you should care about

- response.output_item.added / response.output_item.done
- response.content_part.added / response.content_part.done
- response.output_text.delta / response.output_text.done
- response.completed (and sometimes response.incomplete)

The delta/done pair is used for token-by-token text. Item/part added/done helps when a server chooses to send only higher-level snapshots.

### Minimal handling flow

1) Initialize buffers when a content part is added

```ts
// Map<item_id, { parts: Map<content_index, string> }>
const itemBuffers = new Map<string, { parts: Map<number, string> }>();

function onContentPartAdded(e: {
  type: 'response.content_part.added';
  item_id: string;
  content_index: number;
}) {
  const rec = itemBuffers.get(e.item_id) || { parts: new Map<number, string>() };
  if (!rec.parts.has(e.content_index)) rec.parts.set(e.content_index, '');
  itemBuffers.set(e.item_id, rec);
}
```

2) Append deltas as they arrive

```ts
function onOutputTextDelta(e: {
  type: 'response.output_text.delta';
  item_id: string;
  content_index: number;
  delta: string;
}) {
  const rec = itemBuffers.get(e.item_id) || { parts: new Map<number, string>() };
  const prev = rec.parts.get(e.content_index) || '';
  rec.parts.set(e.content_index, prev + e.delta);
  itemBuffers.set(e.item_id, rec);
}
```

3) Finalize a part when done

```ts
function onContentPartDone(e: {
  type: 'response.content_part.done';
  item_id: string;
  content_index: number;
  part: { type: 'output_text'; text: string };
}) {
  const rec = itemBuffers.get(e.item_id) || { parts: new Map<number, string>() };
  rec.parts.set(e.content_index, e.part.text);
  itemBuffers.set(e.item_id, rec);
}
```

4) Consolidate on item done

```ts
function onOutputItemDone(e: {
  type: 'response.output_item.done';
  item: { id: string; type: 'message'; content: { type: 'output_text'; text: string }[] };
}) {
  const rec = itemBuffers.get(e.item.id);
  // Prefer deltas if present, otherwise fall back to item.content’s full text
  let text = '';
  if (rec && rec.parts.size > 0) {
    text = [...rec.parts.entries()].sort((a,b) => a[0]-b[0]).map(([,v]) => v).join('');
  } else {
    for (const c of e.item.content) if (c.type === 'output_text') text += c.text;
  }
  // Append to your conversation object / LangMessages
  // messages.answer += text; messages.addAssistantMessage(messages.answer) on completion
}
```

5) Finish on response.completed (or response.incomplete)

```ts
function onCompleted() {
  // Mark conversation finished; ensure last assistant message content is set
}
```

### Notes

- Some responses only send deltas; others may send only “done” events with full text in item/content. Handle both.
- Use Accept: text/event-stream and iterate lines to parse SSE frames.
- For simple prompts (single user text), providers may accept a plain string `input`; for multi-turn/structured inputs, use structured arrays.

This approach ensures correct assembly of interleaved outputs and produces a stable final answer while supporting streaming updates.


