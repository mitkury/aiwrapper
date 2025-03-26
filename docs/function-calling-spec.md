# Function Calling Specification for AIWrapper

This document outlines the implementation of function calling capabilities for AIWrapper, allowing models to call defined functions during conversations.

## Introduction

Function calling (also known as "tools" in some APIs) enables language models to request specific functions to be executed during a conversation. This creates a structured way for models to:

1. Request information (like current weather, search results, etc.)
2. Take actions (save data, modify resources, etc.)
3. Process data in specific ways (formatting, calculations, etc.)

This specification describes how we'll integrate function calling across different AI providers while maintaining a consistent API.

## Core Concepts

### 1. Function Definitions

Functions must be defined with:
- A name
- A description of what the function does
- Parameters (with types, descriptions, and optionality)

```typescript
export interface FunctionParameter {
  name: string;
  description?: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  enum?: any[];
  items?: {
    type: "string" | "number" | "boolean" | "object";
    properties?: Record<string, FunctionParameter>;
  };
  properties?: Record<string, FunctionParameter>;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, FunctionParameter>;
}
```

### 2. Function Call Result

The result of a model's function call:

```typescript
export interface FunctionCall {
  name: string; // Name of the called function
  arguments: Record<string, any>; // Arguments provided by the model
}
```

## API Design

### Integration with Existing Methods

We'll refactor the existing `ask` and `chat` methods to consistently use an options object for all parameters, including callbacks, functions, and other settings:

```typescript
interface LangOptions {
  // Streaming callback
  onResult?: (result: LangResult) => void;
  
  // Function calling
  functions?: FunctionDefinition[];
  functionHandler?: (call: FunctionCall) => Promise<any>;
  
  // Other options 
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  // etc.
}

abstract class LanguageProvider {
  // Simplified ask method with consistent options parameter
  abstract ask(
    prompt: string,
    options?: LangOptions
  ): Promise<LangResult>;

  // Simplified chat method with consistent options parameter
  abstract chat(
    messages: LangChatMessages,
    options?: LangOptions
  ): Promise<LangResult>;
}
```

### Enhanced Result Types

We'll enhance the existing result types to include function calls:

```typescript
export interface LangProcessingResult {
  prompt: string;
  finished: boolean;
  thinking?: string;
  functionCalls?: FunctionCall[]; // History of function calls
}

export class LangResult implements LangProcessingResult {
  prompt: string;
  answer: string;
  thinking?: string;
  messages?: LangChatMessages;
  functionCalls?: FunctionCall[];
  finished = false;

  constructor(promptOrMessages: string | LangChatMessages) {
    if (typeof promptOrMessages === 'string') {
      this.prompt = promptOrMessages;
    } else {
      this.messages = promptOrMessages;
      this.prompt = promptOrMessages.length > 0 ? 
        promptOrMessages[promptOrMessages.length - 1].content : "";
    }
    this.answer = "";
  }

  toString(): string {
    return this.answer;
  }
}
```

## Provider-Specific Implementations

Different providers implement function calling in different ways. Here's how we'll handle each:

### 1. OpenAI

OpenAI uses a "tools" field in the request and returns "tool_calls" in responses:

```typescript
class OpenAILang extends OpenAILikeLang {
  // Simplified chat method implementation
  async chat(
    messages: LangChatMessages,
    options?: LangOptions
  ): Promise<LangResult> {
    const result = new LangResult(messages);
    
    // Extract options
    const { 
      onResult, 
      functions, 
      functionHandler,
      temperature,
      maxTokens,
      // other options...
    } = options || {};
    
    // If functions are provided, convert them to OpenAI's format
    let tools;
    if (functions && functions.length > 0) {
      tools = functions.map(f => ({
        type: "function",
        function: {
          name: f.name,
          description: f.description,
          parameters: {
            type: "object",
            properties: this.convertParameters(f.parameters),
            required: this.getRequiredParameters(f.parameters),
          },
        },
      }));
    }
    
    // Rest of implementation...
    
    // Call the onResult callback if provided
    if (onResult) {
      onResult(result);
    }
    
    return result;
  }
}
```

### 2. Anthropic

Anthropic uses a "tools" field with slightly different format:

```typescript
class AnthropicLang extends LanguageProvider {
  // Simplified chat method implementation
  async chat(
    messages: LangChatMessages,
    options?: LangOptions
  ): Promise<LangResult> {
    const result = new LangResult(messages);
    
    // Extract options
    const { 
      onResult, 
      functions, 
      functionHandler,
      temperature,
      maxTokens,
      // other options...
    } = options || {};
    
    // If functions are provided, convert them to Anthropic's format
    let tools;
    if (functions && functions.length > 0) {
      tools = functions.map(f => ({
        name: f.name,
        description: f.description,
        input_schema: {
          type: "object",
          properties: this.convertParameters(f.parameters),
          required: this.getRequiredParameters(f.parameters),
        },
      }));
    }
    
    // Rest of implementation...
    
    // Call the onResult callback if provided
    if (onResult) {
      onResult(result);
    }
    
    return result;
  }
}
```

## Function Call Handling

For handling function calls from the model, we'll add processing logic in each provider implementation:

```typescript
// Example for OpenAI
const onData = (data: any) => {
  // Existing streaming response handling...
  
  // Handle function calls
  if (data.choices && data.choices[0].delta.tool_calls) {
    const toolCall = data.choices[0].delta.tool_calls[0];
    
    // Initialize or update the function call in progress
    let currentFunctionCall = result.functionCalls?.find(f => f.name === toolCall.function.name);
    if (!currentFunctionCall) {
      currentFunctionCall = {
        name: toolCall.function.name,
        arguments: {},
      };
      result.functionCalls = [...(result.functionCalls || []), currentFunctionCall];
    }
    
    // Update arguments
    if (toolCall.function.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        currentFunctionCall.arguments = {...currentFunctionCall.arguments, ...args};
      } catch (e) {
        // Handle partial JSON
      }
    }
    
    // Call the streaming callback with updated result
    if (onResult) {
      onResult(result);
    }
    
    // If function call is complete, execute the function if handler provided
    if (data.choices[0].finish_reason === "tool_calls" && functionHandler) {
      // Call the handler with the function call
      const functionResult = await functionHandler(currentFunctionCall);
      
      // Add function result to messages for the next request
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: toolCall.id,
          type: "function",
          function: {
            name: currentFunctionCall.name,
            arguments: JSON.stringify(currentFunctionCall.arguments)
          }
        }]
      });
      
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(functionResult)
      });
      
      // Continue the conversation with the function result
      return this.chat(messages, options);
    }
  }
};
```

## Usage Examples

### Basic Example Without Functions

```typescript
import { Lang } from "aiwrapper";

// Initialize a model
const lang = Lang.openai({ apiKey: "YOUR KEY" });

// Simple usage without functions
const result = await lang.ask("What's the capital of France?", {
  temperature: 0.7,
  onResult: (partialResult) => {
    console.log("Streaming response:", partialResult.answer);
  }
});

console.log("Final answer:", result.answer);
```

### Basic Function Calling

```typescript
import { Lang } from "aiwrapper";

// Define functions
const functions = [
  {
    name: "getCurrentWeather",
    description: "Get the current weather in a given location",
    parameters: {
      location: {
        type: "string",
        description: "The city and state, e.g., San Francisco, CA",
        required: true,
      },
      unit: {
        type: "string",
        enum: ["celsius", "fahrenheit"],
        description: "The unit of temperature",
        required: false,
      },
    },
  },
];

// Initialize a model that supports function calling
const lang = Lang.openai({ apiKey: "YOUR KEY", model: "gpt-4-turbo" });

// Use function calling with options
const result = await lang.ask("What's the weather like in San Francisco?", { 
  functions, 
  functionHandler: async (call) => {
    // Handle function calls here
    if (call.name === "getCurrentWeather") {
      return { temperature: 72, unit: call.arguments.unit || "fahrenheit", condition: "sunny" };
    }
    return null;
  },
  onResult: (partialResult) => {
    console.log(partialResult.answer);
    
    // You can also see function calls as they happen
    if (partialResult.functionCalls && partialResult.functionCalls.length > 0) {
      console.log("Function called:", partialResult.functionCalls);
    }
  }
});

// Final answer after function calling
console.log(result.answer);
```

### Function Calling with Chat History

```typescript
const messages = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "I'm planning a trip to San Francisco." },
  { role: "assistant", content: "That sounds exciting! When are you planning to go?" },
  { role: "user", content: "Next week. What's the weather like there now?" },
];

const result = await lang.chat(messages, { 
  functions,
  functionHandler: async (call) => {
    if (call.name === "getCurrentWeather") {
      // In a real app, you would call a weather API here
      return { temperature: 72, unit: "fahrenheit", condition: "sunny" };
    }
    return null;
  },
  onResult: (partialResult) => {
    // Stream the response
    console.log(partialResult.answer);
  }
});

console.log(result.answer);
```

## Implementation Plan

1. Add new interfaces and types for function definitions and results
2. Enhance `LanguageProvider` and result types to handle functions
3. Refactor the API to consistently use options objects
4. Modify each provider implementation to:
   - Accept functions and other options
   - Convert functions to provider-specific formats
   - Handle function call responses
   - Execute functions via the handler and continue conversations
5. Add a capability check system to identify which models support function calling
6. Implement testing for function calling capabilities

## Compatibility and Fallbacks

For providers or models that don't support function calling:

1. We'll add a method to check if a model can use functions: `canUseFunction()`
2. Providers will throw errors if functions are provided but not supported
3. Document which providers and models support native function calling

## Advanced Features (Future Work)

1. Support for parallel function calls
2. Automatic function selection by the model
3. Streaming function call results
4. User-controlled function permissions
5. Conversion between different providers' function calling formats