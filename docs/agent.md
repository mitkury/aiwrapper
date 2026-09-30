# Agents and tools

`ChatAgent` keeps conversation history and repeats language-provider calls until
local tools are resolved and the model answers. Use `Lang` directly when you
want to manage that loop yourself.

## Run an agent

```ts
import { ChatAgent, Lang, LangMessage, type LangTool } from "aiwrapper";

const tools: LangTool[] = [{
  name: "add",
  description: "Add two numbers",
  parameters: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  handler: ({ a, b }) => a + b,
}];
const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY! });
const agent = new ChatAgent(lang, { tools, maxIterations: 8 });
const result = await agent.run([new LangMessage("user", "Add 2 and 3.")]);
console.log(result.answer);
```

An array passed to `run()` appends to existing history. A `LangMessages`
collection replaces it. `getMessages()` returns the current conversation.
One run permits eight model calls by default and rejects if the model is still
requesting tools at the limit. Each agent accepts only one active run at a time.

## Local tools

`LangTool` is shared by language providers, `ChatAgent`, `RealtimeAgent`, and
native live sessions. Handlers receive arguments and `{ callId, name, signal }`:

```ts
handler: async (args, { signal }) => fetchToolResult(args, { signal })
```

Providers assemble streamed arguments, execute local handlers, and append a
`tool-results` message. With `Lang`, call `chat(result)` again to let the model
use those results. `ChatAgent` repeats automatically. Put tools on
`LangMessages.availableTools` or pass `tools` in call options to override them
for one request; `tools: []` disables them for that call.

Handler failures become structured tool errors. `AbortError` propagates as
cancellation; results from already completed tools remain in partial history.
Handlers must honor their signal to stop work. Cancellation cannot undo a
completed side effect.

Inspect `message.toolRequests` and `message.toolResults` for calls and outcomes.
Plain handler return values use the existing JSON/text representation.

## Image tool results

Use `toolResult()` to return content parts to the model:

```ts
import { toolResult } from "aiwrapper";

// Inside a tool handler, using image bytes supplied by your application:
return toolResult([
  { type: "text", text: "Current camera frame" },
  { type: "image", bytes: jpegBytes, mimeType: "image/jpeg" },
]);
```

Image parts accept exactly one of `url`, `base64`, or `bytes`, with an optional
MIME type. Provider support differs:

- OpenAI Responses and Anthropic support images in tool results.
- Google maps images into `functionResponse`; choose a model supporting image
  tool results and return bytes or base64 instead of remote URLs.
- Bedrock supports image tool results as bytes/base64/data URLs.
- Chat Completions-compatible providers and Ollama reject image tool results.

Native live sessions accept text and JSON-serializable tool results, not image
content parts or provider-managed built-ins. They execute handlers and continue
the model automatically. Results are normalized once: `undefined` becomes `{}`,
`null` remains `null`, and unserializable values become tool errors. Gemini and OpenAI
support [manual result delivery](live-sessions.md#tool-ownership).

## Provider-managed tools

Built-in tools have no local handler. Names and options depend on the provider:

```ts
import { LangMessages } from "aiwrapper";

const messages = new LangMessages("Find recent astronomy news", {
  tools: [{ name: "web_search" }],
});
const result = await lang.chat(messages);
```

OpenAI built-ins include search, MCP, image generation, code execution, and
computer use. Their availability depends on the selected model.

## Events and cancellation

```ts
const unsubscribe = agent.subscribe(event => {
  if (event.type === "streaming") console.log(event.data.msg.text);
  if (event.type === "finished") console.log(event.output.answer);
  if (event.type === "aborted") console.log(event.partial?.answer);
  if (event.type === "error") console.error(event.error);
});
const controller = new AbortController();
const pending = agent.run([new LangMessage("user", "Write a story.")], {
  signal: controller.signal,
});
controller.abort();
await pending;
unsubscribe();
```

Agents also emit `state` events. Listener failures are logged without stopping
other listeners. On cancellation, `ChatAgent` retains and resolves with a
provider's partial conversation when one exists; otherwise it rethrows the
`AbortError`.

Before another provider call, `fixToolResultsIfNeeded` repairs incomplete tool
pairs by inserting a result of `"aborted"` and logging a warning. It does not
execute the missing tool or claim success. Applications can instead persist
explicit cancelled results for each unfinished call.

## Custom agents

Extend `Agent<Input, Output, CustomEvent>` and implement `runInternal(input,
options)`. The base class owns run state and failure handling; subclasses emit
their own `finished` event. There is no base `input()` queue. See
[the Agent contract](../src/agents/agent.ts) for the extension points and
[RealtimeAgent](realtime-agent.md) for a continuous speech pipeline.
