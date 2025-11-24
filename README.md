# AIWrapper

A universal AI wrapper for JavaScript & TypeScript.

Use LLMs from anywhere—servers, browsers and web-apps. AIWrapper works in
anything that runs JavaScript.

> :warning: **It's in early WIP stage and the API may change.**

## Features

- Generate plain text or JSON objects with a simple API
- Use different LLM providers: OpenAI, Anthropic, Groq, DeepSeek, Ollama and any
  OpenAI-compatible services
- Output objects based on Zod schemas or JSON Schema
- Swap models quickly or chain different models together
- Use it with JavaScript or TypeScript from anywhere

## Installation

```bash
npm install aiwrapper
```

## Quick Start

### Agents with Tools

If you need the AI to use tools, start with `ChatAgent`.

```javascript
import { ChatAgent, Lang, LangMessage } from "aiwrapper";
import { getTools } from "<your script>";

const lang = Lang.openai({ apiKey: "<key>" });
const agent = new ChatAgent(lang, { tools: getTools() });

const result = await agent.run([
  new LangMessage(
    "user",
    "Find the deployment checklist and send it to Alex B",
  ),
]);

console.log(result.answer);
// Full conversation history is available via agent.getMessages()
```

### Generate Text

For simpler text/JSON generation without tools, use the basic `Lang`.

```javascript
import { Lang } from "aiwrapper";

const lang = Lang.openai({ apiKey: "YOUR KEY" });
const result = await lang.ask("Say hi!");
console.log(result.answer);
```

## Lang (LLM) Examples

### Initialize a Model

```javascript
import { Lang } from "aiwrapper";

const lang = Lang.openai({ apiKey: "YOUR KEY" }); // or Lang.anthropic
```

### Connect to Custom OpenAI-compatible APIs

```javascript
import { Lang } from "aiwrapper";

// Connect to a custom OpenAI-compatible API
const lang = Lang.openaiLike({
  apiKey: "YOUR KEY", // Optional - not needed for APIs without authentication
  model: "model-name",
  baseURL: "https://your-custom-api.example.com/v1",
  systemPrompt: "Optional system prompt",

  // Optional headers for authentication or other purposes
  headers: {
    "X-Custom-Header": "custom-value",
    "Authorization": "Basic dXNlcm5hbWU6cGFzc3dvcmQ=", // Alternative auth method example
  },

  // Additional properties to include in the request body
  bodyProperties: {
    temperature: 0.7,
    presence_penalty: 0.6,
    frequency_penalty: 0.1,
  },
});

// Use it just like any other LLM provider
const result = await lang.ask("Hello!");
console.log(result.answer);
```

### Use OpenRouter (Access 100+ Models)

```javascript
import { Lang } from "aiwrapper";

// Basic OpenRouter usage
const lang = Lang.openrouter({
  apiKey: "YOUR_OPENROUTER_API_KEY",
  model: "openai/gpt-4o", // Or any model from OpenRouter's catalog
});

// With optional site information for rankings
const langWithSiteInfo = Lang.openrouter({
  apiKey: "YOUR_OPENROUTER_API_KEY",
  model: "anthropic/claude-3.5-sonnet",
  siteUrl: "https://your-app.com", // Optional: appears on OpenRouter leaderboards
  siteName: "Your App Name", // Optional: appears on OpenRouter leaderboards
  systemPrompt: "You are a helpful assistant.",
  maxTokens: 4000,
});

const result = await langWithSiteInfo.ask(
  "Explain quantum computing in simple terms",
);
console.log(result.answer);
```

### Stream Results

```javascript
await lang.ask("Hello, AI!", {
  onResult: (msg) => console.log(msg),
});
```

### Use Templates

```javascript
// In most cases - a prompt template should be just a function that returns a string
function getPrompt(product) {
  return `You are a naming consultant for new companies. What is a good name for a company that makes ${product}?     
Write just the name. Nothing else aside from the name - no extra comments or characters that are not part of the name.`;
}

const prompt = getPrompt("colorful socks");

await lang.ask(prompt, {
  onResult: (msg) => console.log(msg),
});
```

### Conversation Management

```javascript
// Start a conversation
const result = await lang.ask("Hello, who are you?");
console.log(result.answer);

// Add a user message and continue the conversation
result.addUserMessage("Tell me more about yourself");
const newResult = await lang.chat(result);
console.log(newResult.answer);

// Continue the conversation further
newResult.addUserMessage("What can you help me with?");
const finalResult = await lang.chat(newResult);
console.log(finalResult.answer);

// You can also create message collections directly
import { LangMessages } from "aiwrapper";

const messages = new LangMessages();
messages.instructions = "You are a helpful assistant.";
messages.addUserMessage("Tell me about TypeScript.");

const chatResult = await lang.chat(messages);
console.log(chatResult.answer);
```

### Getting Objects from LLMs

```javascript
// We can ask for an object with a particular schema
// You can use either Zod schemas or JSON Schema

// Option 1: Using Zod schema (recommended for TypeScript users)
import { z } from "aiwrapper";

// Schema for an array of strings
const companyNamesSchema = z.array(z.string());

const result = await lang.askForObject(
  "You are a naming consultant for new companies. What are 3 good names for a company that makes colorful socks?",
  companyNamesSchema,
);

// TypeScript automatically infers the type as string[]
console.log(result.object); // ["Chromatic Toe", "SockSpectra", "VividStep"]

// Option 2: Using JSON Schema (compatible with existing code)
const jsonSchema = {
  type: "array",
  items: {
    type: "string",
  },
};

const result2 = await lang.askForObject(
  "You are a naming consultant for new companies. What are 3 good names for a company that makes colorful socks?",
  jsonSchema,
);

console.log(result2.object); // ["Chromatic Toe", "SockSpectra", "VividStep"]
```

### Getting Complex Objects

```javascript
// Option 1: Using Zod schema
import { z } from "aiwrapper";

// Define a schema using Zod
const companySchema = z.object({
  name: z.string(),
  tagline: z.string(),
  marketingStrategy: z.object({
    target: z.string(),
    channels: z.array(z.string()),
    budget: z.number(),
  }),
});

// TypeScript automatically infers the correct type
const result = await lang.askForObject(
  "Create a company profile for a business that makes colorful socks",
  companySchema,
);

console.log(result.object);
// The object is fully typed with TypeScript!

// Option 2: Using JSON Schema
const jsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    tagline: { type: "string" },
    marketingStrategy: {
      type: "object",
      properties: {
        target: { type: "string" },
        channels: {
          type: "array",
          items: { type: "string" },
        },
        budget: { type: "number" },
      },
    },
  },
  required: ["name", "tagline", "marketingStrategy"],
};

const result2 = await lang.askForObject(
  "Create a company profile for a business that makes colorful socks",
  jsonSchema,
);

console.log(result2.object);
/* Example output:
{
  "name": "ChromaSocks",
  "tagline": "Step into Color, Step into Life",
  "marketingStrategy": {
    "target": "Fashion-conscious young adults aged 18-35",
    "channels": ["Instagram", "TikTok", "Influencer partnerships"],
    "budget": 50000
  }
}
*/
```
