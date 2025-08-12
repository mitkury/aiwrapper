### Tool calling in aiwrapper

This package supports tool (function) calling with OpenAI-compatible providers and a mock provider for testing.

- Define your tools with `name`, `description`, and JSON Schema `parameters`.
- When the model requests a tool during streaming, `LangResult.tools` will contain the pending tool calls with parsed `arguments`.
- Execute your tool(s), append results using `result.addToolUseMessage([...])`, and continue the chat.
- Or use the helper `executeToolsAndContinue` to do this in one step.

#### Example
```ts
import { Lang, executeToolsAndContinue } from 'aiwrapper';

const openai = Lang.openai({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' });

const tools = [
  {
    name: 'add',
    description: 'Add two numbers',
    parameters: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a','b']
    }
  }
];

const registry = {
  add: ({ a, b }: any) => a + b
};

// Start the chat
const first = await openai.chat([
  { role: 'user', content: 'Please add 2 and 3 using a tool.' }
], { tools });

// If the model requested a tool, execute and continue
const final = await executeToolsAndContinue(openai, first, registry);

console.log(final.answer);
```

Notes:
- Streaming tool calls are supported: the package safely assembles partial `function.arguments` chunks into a valid JSON object.
- For providers with different message formats, this package adapts request messages and streaming parsing under the hood.