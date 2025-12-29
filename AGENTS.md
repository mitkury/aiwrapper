This is a context for AI editor/agent about the project. It's generated with a tool Airul (https://github.com/mitkury/airul) out of 4 sources. Edit .airul.json to change sources or enabled outputs. After any change to sources or .airul.json, run `airul gen` to regenerate the context.

# From README.md:

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
---

# From docs/dev/for-ai/proposals.md:

# Proposals for development

When a developer asks to create a proposal for a feature or major change - write the proposal as a Markdown file in /docs/dev/proposals. Before writing a proposal explore all relevant systems and documents.

Give the developer some time to review the proposal. Expect feedback and questions.
---

# From docs/dev/for-ai/rules-for-ai.md:

# Basics for AI agents

# Git commits
Use imperative mood and use a prefix for the type of change.
Examples:
feat(auth): add user login
fix(payment): resolve gateway timeout
ci: update release workflow
docs: update README
dev: add the core and the client as aliases to the sveltkit config

### Commit types
Any product-related feature - "feature(name): description"
Any product-related fix - "fix(name): description"
Anything related to building and releasing (including fixes of CI) - "ci: description"
Anything related to testing - "tests: description"
Anything related to documentation - "docs: description"
Anything related to the build pipelines and dev convinience - "dev: description"

### Testing
To run a specific test suite against a single provider, set the `PROVIDERS` env variable and execute Vitest in non-interactive mode. Example:
`PROVIDERS=openai npx vitest run tests/agents/chat-agent.test.ts`
This runs the `chat-agent` suite using only the OpenAI provider. Make sure you use `vitest run` (or keep the `--run` flag) so the test run completes once and doesn't wait for file changes.
Before running `npx vitest run ...`, rebuild the package if you've changed the source by executing `npm run build`. You can skip the manual build when using `npm test`, since the `pretest` script already runs the build step for you. For common subsets, there are helper scripts (for example, `npm run test:lang` runs only the Lang suites and already performs a build).

## Publishing Steps
When publishing, follow these steps in order:
1. Build and test: `npm run build && npm test`
2. Commit changes with scope prefix: `feat: short description`
3. Push changes: `git push`
4. Create patch version: `npm version patch`
5. Push tags: `git push --tags`
6. Publish: `npm publish`
---

# From package.json:

{
  "type": "module",
  "name": "aiwrapper",
  "description": "A Universal AI Wrapper for JavaScript & TypeScript",
  "version": "3.0.0-beta.5",
  "author": "Dmitry Kury (https://dkury.com)",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mitkury/aiwrapper.git"
  },
  "bugs": {
    "url": "https://github.com/mitkury/aiwrapper/issues"
  },
  "homepage": "https://github.com/mitkury/aiwrapper#readme",
  "keywords": [
    "AI",
    "AI Wrappers",
    "OpenAI",
    "LLM",
    "Generative AI",
    "GPT",
    "GPT-4",
    "Anthropic",
    "Groq",
    "Mistral",
    "Llama",
    "Ollama",
    "DeepSeek"
  ],
  "files": [
    "dist/",
    "LICENSE"
  ],
  "main": "./dist/index.js",
  "allowJs": true,
  "scripts": {
    "preinstall": "npx airul gen",
    "prebuild": "rm -rf dist",
    "build": "node build.js",
    "serve": "npx serve .",
    "pretest": "npm run build",
    "test": "vitest run",
    "test:lang": "npm run build && vitest run tests/lang/*.test.ts",
    "test:agents": "npm run build && vitest run tests/agents/*.test.ts",
    "test:img-in": "npm run build && vitest run tests/img-in/*.test.ts",
    "test:img-out": "npm run build && vitest run tests/img-out/*.test.ts",
    "test:reasoning": "npm run build && vitest run tests/reasoning/*.test.ts",
    "aimodels:link": "./scripts/link-aimodels-local.sh",
    "aimodels:unlink": "./scripts/unlink-aimodels-local.sh"
  },
  "dependencies": {
    "aimodels": "^0.5.2",
    "ajv": "^8.17.1",
    "jsonic": "^2.16.0",
    "zod": "^3.24.4",
    "zod-to-json-schema": "^3.24.6"
  },
  "devDependencies": {
    "@playwright/test": "^1.42.1",
    "@types/node": "^20.11.16",
    "airul": "^0.1.39",
    "dotenv": "^16.4.1",
    "dts-bundle-generator": "^9.5.1",
    "esbuild": "^0.25.2",
    "glob": "^11.0.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.8.2",
    "vitest": "^1.2.1"
  }
}