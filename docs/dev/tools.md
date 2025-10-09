### Tool calling in aiwrapper

This package supports tool (function) calling with OpenAI-compatible providers and other providers.

- Define tools with `name`, `description`, JSON Schema `parameters`, and a `handler` function
- Pass tools when creating a `LangMessages` instance
- Tools are **automatically executed** when the model requests them during `chat()`
- Tool results are automatically added to the conversation as `tool-results` messages

#### Example
```ts
import { Lang, LangMessages } from 'aiwrapper';

const openai = Lang.openai({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' });

const messages = new LangMessages([
  { role: 'user', content: 'Please add 2 and 3 using a tool.' }
], {
  tools: [
    {
      name: 'add',
      description: 'Add two numbers',
      parameters: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b']
      },
      handler: ({ a, b }: any) => a + b
    }
  ]
});

// Tools are automatically executed when the model requests them
const result = await openai.chat(messages);

console.log(result.answer);
```

#### Continuing conversations with tool results
```ts
// Continue the conversation after tools have been executed
const followUp = await openai.chat(result);
console.log(followUp.answer);
```

#### Checking tool execution
```ts
// Check which tools were called
const requested = result.toolsRequested; // Array of ToolRequest objects

// Check tool results in the message history
const toolResultsMsg = result.find(m => m.role === 'tool-results');
if (toolResultsMsg) {
  console.log(toolResultsMsg.content); // Array of ToolResult objects
}
```

Notes:
- Streaming is fully supported: the package safely assembles partial `function.arguments` chunks into valid JSON
- Tools are executed automatically via `executeRequestedTools()` which is called internally by `chat()`
- For providers with different message formats, the package adapts request messages and streaming parsing under the hood