# Migrating to the New AIWrapper API

This guide covers how to migrate from the previous API to the new unified API.

## Key Changes

1. All methods now return a unified `LangResult` object
2. Messages are mutated in-place for better performance
3. Options are consolidated into a single options object
4. Tools support is added (coming soon)

## Migration Examples

### Before:

```typescript
// Simple text generation
const result = await lang.ask(
  "Tell me about yourself",
  (partialResult) => {
    console.log("Streaming:", partialResult.answer);
  }
);
console.log(result.answer);

// Chat conversation
const messages = [
  { role: "user", content: "Hello" }
];
const chatResult = await lang.chat(
  messages,
  (partialResult) => {
    console.log("Streaming:", partialResult.answer);
  }
);
console.log(chatResult.answer);

// Object extraction
const objectResult = await lang.askForObject(
  {
    prompt: "List planets",
    objectExamples: [
      [{ name: "Earth", diameter: 12742 }]
    ]
  },
  (partialResult) => {
    console.log("Streaming:", partialResult.answer);
  }
);
console.log(objectResult.answerObj);
```

### After:

```typescript
// Simple text generation
const result = await lang.ask(
  "Tell me about yourself",
  { 
    onResult: (partialResult) => {
      console.log("Streaming:", partialResult.answer);
    }
  }
);
console.log(result.answer);

// Chat conversation
const initialResult = await lang.ask("Hello");
initialResult.addUserMessage("How are you?");
const nextResult = await lang.chat(
  initialResult.messages,
  { 
    onResult: (partialResult) => {
      console.log("Streaming:", partialResult.answer);
    }
  }
);
console.log(nextResult.answer);

// Object extraction
const objectResult = await lang.askForObject(
  "List planets",
  [{ name: "Earth", diameter: 12742 }],
  { 
    onResult: (partialResult) => {
      console.log("Streaming:", partialResult.answer);
    }
  }
);
console.log(objectResult.object);
```

## Working with Conversations

The new API makes it easier to manage conversations:

```typescript
// Start a conversation
const result = await lang.ask("Hello");

// Add messages and continue
result.addUserMessage("Tell me more");
const newResult = await lang.chat(result.messages);

// Messages are mutated in-place
console.log(result.messages === newResult.messages); // true

// If you need immutability, create explicit copies
const immutableMessages = [...result.messages];
```

## Using Tools (Coming Soon)

The new API will support tools:

```typescript
// Define a tool
const calculatorTool = {
  name: "calculator",
  description: "Perform calculations",
  parameters: {
    expression: {
      type: "string",
      description: "Math expression to evaluate"
    }
  }
};

// Ask with tools
const result = await lang.ask(
  "What is 123 * 456?",
  { tools: [calculatorTool] }
);

// Check if the model wants to use tools
if (result.tools) {
  // Execute tools externally
  const toolResults = result.tools.map(tool => {
    if (tool.name === "calculator") {
      const answer = eval(tool.arguments.expression);
      return { toolId: tool.id, result: answer };
    }
  });
  
  // Add results back to the conversation
  result.addToolUseMessage(toolResults);
  
  // Continue the conversation
  const finalResult = await lang.chat(result.messages);
  console.log(finalResult.answer);
}
```

## Benefits of the New API

1. **More intuitive**: Unified return type makes API more consistent
2. **Better performance**: In-place message mutation reduces memory usage
3. **More powerful**: Built-in support for tools and structured data
4. **More flexible**: Options object allows for easier extensibility
5. **Simpler conversation management**: Helper methods make it easy to build complex conversations