# AIWrapper API Redesign Proposal
*April 1, 2025*

This document proposes changes to the API of language-provider.ts to make it more consistent, intuitive, and powerful.

## Key Changes

1. Unify return types for all methods (`ask`, `chat`, etc.)
2. Simplify handling of conversations and message history
3. Consolidate options handling with a unified options object
4. Simplify `askForObject` to use a more direct signature
5. Improve tool usage flow to match real-world LLM interactions

## Proposed API Structure

### LangResult

All methods will return a unified `LangResult` object containing:

```typescript
class LangResult {
  // The text answer from the LLM
  answer: string;
  
  // Parsed object (if schema was provided)
  object: any | null;
  
  // Tool calls requested by the model (if applicable)
  tools: ToolRequest[] | null;
  
  // The full conversation history including the AI's response
  messages: LangChatMessages;
  
  // Helper methods
  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }
  
  // Add tool execution results back to the conversation
  addToolUseMessage(toolResults: ToolResult[]): void {
    this.messages.push({ role: "tool", content: toolResults });
  }
}
```

### Unified Options

All methods will accept an optional options object:

```typescript
interface LangOptions {
  // Available tools
  tools?: Tool[];
  
  // Streaming callback
  onResult?: (result: LangResult) => void;
  
  // Other options (temperature, etc.)
  [key: string]: any;
}
```

### Core Methods

```typescript
// Simple text generation
async ask(prompt: string, options?: LangOptions): Promise<LangResult>;

// Continue a conversation
async chat(messages: LangChatMessages, options?: LangOptions): Promise<LangResult>;

// Directly get structured data (with a more discoverable API)
async askForObject<T>(prompt: string, schema: T, options?: LangOptions): Promise<LangResult>;
```

## Usage Examples

### Simple Text Generation

```typescript
const result = await lang.ask("Tell me about yourself");
console.log(result.answer);
```

### Continuing a Conversation

```typescript
// Start a conversation
const result = await lang.ask("Tell me about yourself");

// Add a user message and continue
result.addUserMessage("Tell me more");
const newResult = await lang.chat(result.messages);

// Add another and continue again
newResult.addUserMessage("That's interesting");
const finalResult = await lang.chat(newResult.messages);

console.log(finalResult.messages); // Full conversation history
```

### Getting Structured Data

```typescript
// Using the dedicated method for structured data
const planets = await lang.askForObject(
  "List the planets in our solar system with their diameters",
  Array<{ name: string, diameter: number, unit: string }>
);

console.log(planets.object); // Structured array of planet objects
```

### Using Tools

```typescript
var weatherResult = await lang.ask(
  "What's the weather in New York and Los Angeles?", 
  { 
    tools: [getWeatherTool]
  }
);

console.log(weatherResult.tools); // Tool use request from the model

// Execute the tools externally
const toolUseResults = useTools(weatherResult.tools);

// Add tool results back to the conversation
weatherResult.addToolUseMessage(toolUseResults);

// Continue the conversation with tool results
weatherResult = await lang.chat(weatherResult.messages);

console.log(weatherResult.answer); // Final response incorporating tool results
```

### Combining Object Extraction and Tools

```typescript
// First get the tool usage
var restaurantResult = await lang.ask(
  "Find the top-rated restaurants in Chicago", 
  { 
    tools: [searchRestaurantsTool]
  }
);

// Execute tools
const restaurantData = useTools(restaurantResult.tools);
restaurantResult.addToolUseMessage(restaurantData);

// Get structured data using askForObject with the conversation
const structuredResult = await lang.askForObject(
  restaurantResult.messages,
  Array<{ name: string, cuisine: string, rating: number }>
);

console.log(structuredResult.object); // Structured restaurant data
```

## Benefits

1. **More Consistent API**: Unified return types
2. **Simplified Conversation Flow**: Easy to build multi-turn conversations
3. **Discoverable Object Extraction**: Dedicated method makes it obvious
4. **Realistic Tool Usage**: Properly models the back-and-forth nature of tool usage
5. **Progressive Complexity**: Simple use cases remain simple
6. **Composable Functionality**: Easy to combine features
7. **Improved Developer Experience**: More intuitive and less boilerplate
8. **Future-proof Design**: Accommodates emerging LLM capabilities

```ts
var messages = await lang.ask("tell me about yourself");

messages.addFromUser("ok go on");

messages = await lang.chat(messages);

messages.addFromUser("that is crazy");

messages = await lang.chat(messages);

console.log(messages);
```

Everything else aside from messages go into options:
```ts
const newMessages = await lang.chat(messages, { tools, onResult });
```