# Tool calling

AIWrapper supports local function tools and provider-managed built-in tools.

## Local tools

A local tool has a name, description, JSON Schema parameters, and a handler.

```ts
import { Lang, LangMessages } from "aiwrapper";

const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY });
const messages = new LangMessages("Add 2 and 3 using the tool", {
  tools: [
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
  ],
});

const result = await lang.chat(messages);
```

Providers execute requested local handlers after the response and append a `tool-results` message. Call `chat(result)` again to let the model use those results. `ChatAgent` performs that loop automatically.

## Inspecting calls and results

```ts
const assistant = result.find(message => message.role === "assistant");
console.log(assistant?.toolRequests);

const toolResults = result.find(message => message.role === "tool-results");
console.log(toolResults?.toolResults);
```

Streaming providers assemble partial function arguments before invoking handlers. Handler errors are returned to the model as structured error results instead of escaping the tool loop.

## Built-in tools

Built-in tools run at the provider and do not have a local handler.

```ts
const messages = new LangMessages("Find the current weather in Paris", {
  tools: [{ name: "web_search" }],
});
```

Built-in tool names and configuration are provider-specific. OpenAI-specific types include web search, file search, MCP, image generation, code interpreter, and computer use.
