# AIWrapper
A universal AI wrapper for JavaScript & TypeScript.

Use LLMs from anywhere—servers, browsers and web-apps. AIWrapper works in anything that runs JavaScript.

> :warning: **It's in early WIP stage and the API may change.**


## Features
- Generate plain text or JSON objects with a simple API
- Use different LLM providers: OpenAI, Anthropic, Groq, DeepSeek, Ollama and any OpenAI-compatible services
- Output objects based on needed schemas
- Swap models quickly or chain different models together
- Use it with JavaScript or TypeScript from anywhere

## Installation
Install with npm or import in Deno by URL.

### NPM
```bash
npm install aiwrapper
```

### Deno
```typescript
import * as aiwrapper from "https://deno.land/x/aiwrapper/mod.ts";
```

## Quick Start

### Generate Text
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
    "Authorization": "Basic dXNlcm5hbWU6cGFzc3dvcmQ=" // Alternative auth method example
  },
  
  // Additional properties to include in the request body
  bodyProperties: {
    temperature: 0.7,
    presence_penalty: 0.6,
    frequency_penalty: 0.1
  }
});

// Use it just like any other LLM provider
const result = await lang.ask("Hello!");
console.log(result.answer);
```

### Stream Results
```javascript
await lang.ask("Hello, AI!", { 
  onResult: (streamingResult) => {
    console.log(streamingResult.answer);
  }
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
  onResult: (streamingResult) => {
    console.log(streamingResult.answer);
  }
});
```

### Conversation Management
```javascript
// Start a conversation
const result = await lang.ask("Hello, who are you?");
console.log(result.answer);

// Add a user message and continue the conversation
result.addUserMessage("Tell me more about yourself");
const newResult = await lang.chat(result.messages);
console.log(newResult.answer);

// Continue the conversation further
newResult.addUserMessage("What can you help me with?");
const finalResult = await lang.chat(newResult.messages);
console.log(finalResult.answer);
```

### Getting Objects from LLMs
```javascript
// We can ask for an object with a particular schema
// Use standard JSON Schema to define the expected structure

// Schema for an array of strings
const companyNamesSchema = {
  type: "array",
  items: {
    type: "string"
  }
};

const result = await lang.askForObject(
  "You are a naming consultant for new companies. What are 3 good names for a company that makes colorful socks?",
  companyNamesSchema
);

console.log(result.object); // ["Chromatic Toe", "SockSpectra", "VividStep"]
```

### Getting Complex Objects
```javascript
// Define a schema using standard JSON Schema format
const companySchema = {
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
          items: { type: "string" }
        },
        budget: { type: "number" }
      }
    }
  },
  required: ["name", "tagline", "marketingStrategy"]
};

const result = await lang.askForObject(
  "Create a company profile for a business that makes colorful socks",
  companySchema
);

console.log(result.object);
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

> **Important:** AIWrapper uses standard [JSON Schema](https://json-schema.org/) to define the structure of expected outputs. Make sure to use the official schema format with `type`, `properties`, and other JSON Schema keywords.