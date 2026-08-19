# Tool calling

AIWrapper supports local function tools and provider-managed built-in tools.
`LangTool` is the canonical definition everywhere an LLM can execute tools,
including ordinary language providers, agents, cascade realtime, and native
speech-to-speech providers.

## Local tools

A local tool has a name, description, JSON Schema parameters, and a handler.

```ts
import { Lang, LangMessages, type LangTool } from "aiwrapper";

const tools: LangTool[] = [
  {
    name: "add",
    description: "Add two numbers",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    },
    handler: ({ a, b }) => a + b,
  },
];

const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY });
const messages = new LangMessages("Add 2 and 3 using the tool", {
  tools,
});

const result = await lang.chat(messages);
```

Providers execute requested local handlers after the response and append a `tool-results` message. Call `chat(result)` again to let the model use those results. `ChatAgent` performs that loop automatically.

Handlers also receive call metadata and the request signal. Existing handlers
that only accept `args` remain valid.

```ts
handler: async (args, { callId, name, signal }) => {
  console.log({ callId, name });
  return fetchToolResult(args, { signal });
}
```

Use `tools` in the `chat()` options to narrow or replace tools for one request
without mutating `messages.availableTools`. An empty array disables tools for
that request.

```ts
await lang.chat(messages, {
  tools: toolsAllowedForThisTurn,
  signal: turnAbortController.signal,
});
```

The same signal is passed to local tool handlers. An `AbortError` from a handler
is propagated as request cancellation instead of being converted into a tool
error for the model.

The same array can be passed to a native speech session without changing the
tool or handler:

```ts
import { LiveLang } from "aiwrapper";

const session = await LiveLang.openai({
  apiKey: process.env.OPENAI_API_KEY!,
}).connect({ tools });

session.addEventListener("tool-call", ({ call }) => console.log(call));
session.addEventListener("tool-result", ({ result }) => console.log(result));
```

OpenAI Realtime, xAI Voice, Gemini Live, Azure Voice Live, and Amazon Nova
Sonic map `LangTool` declarations to their provider protocols and automatically
continue the model after local handlers finish. Native speech sessions currently
support text and JSON-serializable results. Provider-managed built-in tools and
image tool results remain provider-specific and are rejected by this portable
surface.

## Inspecting calls and results

```ts
const assistant = result.find(message => message.role === "assistant");
console.log(assistant?.toolRequests);

const toolResults = result.find(message => message.role === "tool-results");
console.log(toolResults?.toolResults);
```

Streaming providers assemble partial function arguments before invoking handlers. Handler errors are returned to the model as structured error results instead of escaping the tool loop.

## Returning images from tools

Use `toolResult` when a tool should return content parts instead of ordinary JSON or text. The image is sent to the model itself; AIWrapper does not replace it with a generated description.

```ts
import { Lang, LangMessages, toolResult } from "aiwrapper";

const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY });
const messages = new LangMessages("Look through the camera and describe what you see", {
  tools: [{
    name: "capture_camera",
    description: "Capture the current camera frame",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const response = await fetch("https://camera.internal/frame.jpg");
      const bytes = new Uint8Array(await response.arrayBuffer());

      return toolResult([
        { type: "text", text: "Current camera frame" },
        { type: "image", bytes, mimeType: "image/jpeg" },
      ]);
    },
  }],
});

const result = await lang.chat(messages);
```

Image parts accept exactly one of `url`, `base64`, or `bytes`, plus an optional MIME type. Plain handler return values keep their existing JSON/text behavior.

Provider support differs:

- `Lang.openai()` uses the Responses API and sends image parts in `function_call_output`.
- Anthropic sends image parts inside `tool_result.content`.
- Google sends inline image parts in `functionResponse`; this requires a Gemini 3-series model. URL images must be fetched by the handler and returned as base64 or bytes.
- OpenAI-compatible Chat Completions providers and Ollama reject image tool results because their tool-message formats are text-only. For OpenAI, use `Lang.openai()` rather than `Lang.openaiLike()`.

## Built-in tools

Built-in tools run at the provider and do not have a local handler.

```ts
const messages = new LangMessages("Find the current weather in Paris", {
  tools: [{ name: "web_search" }],
});
```

Built-in tool names and configuration are provider-specific. OpenAI-specific types include web search, file search, MCP, image generation, code interpreter, and computer use.
