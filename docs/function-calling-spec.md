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
  enum?: any[];  // List of allowed values for this parameter
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

#### Parameter Types and Constraints

Parameters can have different types and constraints:

1. **Basic Types**:
   - `string`: Text values
   - `number`: Numeric values
   - `boolean`: True/false values
   - `array`: Lists of values
   - `object`: Structured data

2. **Enum Values**:
   The `enum` field allows you to restrict a parameter to a specific set of allowed values. This is useful for:
   - Unit specifications (e.g., temperature units)
   - Status values (e.g., "active", "inactive", "pending")
   - Predefined options (e.g., "small", "medium", "large")

Example with enum:
```typescript
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
        enum: ["celsius", "fahrenheit"],  // Only these two values are allowed
        description: "The unit of temperature",
        required: false,
      },
      condition: {
        type: "string",
        enum: ["sunny", "cloudy", "rainy", "snowy"],  // Predefined weather conditions
        description: "Current weather condition",
        required: true,
      }
    }
  }
];
```

When using this function, the model will only be able to select values from the specified enums. For example:
- `unit` can only be "celsius" or "fahrenheit"
- `condition` can only be one of the four predefined weather conditions

This helps ensure that function calls contain valid values and provides clear options for the model to choose from.

### 2. Function Call Result

The result of a model's function call:

```typescript
export interface FunctionCall {
  id?: string;         // Optional ID from the provider (useful for tracking)
  name: string;        // Name of the called function
  arguments: Record<string, any>; // Arguments provided by the model (parsed)
  rawArguments?: string; // Original arguments string (for provider compatibility)
  provider?: string;   // Provider that generated this call (for debugging)
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
  functionCall?: "none" | "auto" | { name: string };  // OpenAI style function selection
  
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
// OpenAI request format
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "getCurrentWeather",
        "description": "Get the current weather in a given location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "The city and state, e.g., San Francisco, CA"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"],
              "description": "The unit of temperature"
            }
          },
          "required": ["location"]
        }
      }
    }
  ]
}

// OpenAI response format
{
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "getCurrentWeather",
        "arguments": "{\"location\":\"San Francisco, CA\",\"unit\":\"fahrenheit\"}"
      }
    }
  ]
}
```

Key OpenAI characteristics:
- Uses `tools` array with `type: "function"` wrapper
- Returns `tool_calls` array with `id` field
- Arguments are returned as a JSON string
- Supports `function_call` parameter to force specific function calls

### 2. Anthropic

Anthropic uses a "tools" field with a different format and returns "tool_calls" in responses:

```typescript
// Anthropic request format
{
  "tools": [
    {
      "name": "getCurrentWeather",
      "description": "Get the current weather in a given location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "The city and state, e.g., San Francisco, CA"
          },
          "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "description": "The unit of temperature"
          }
        },
        "required": ["location"]
      }
    }
  ]
}

// Anthropic response format
{
  "tool_calls": [
    {
      "id": "tool_abc123",
      "type": "tool",
      "name": "getCurrentWeather",
      "arguments": {
        "location": "San Francisco, CA",
        "unit": "fahrenheit"
      }
    }
  ]
}
```

Key Anthropic characteristics:
- Uses `tools` array directly without type wrapper
- Uses `input_schema` instead of `parameters`
- Returns `tool_calls` array with `id` field
- Arguments are returned as a parsed object (not a string)
- Supports `tool_choice` parameter to force specific tool calls

### Provider-Specific Mappings

We'll handle these differences in our implementation:

```typescript
class OpenAILang extends LanguageProvider {
  protected convertToProviderFormat(functions: FunctionDefinition[]): any[] {
    return functions.map(f => ({
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

  protected convertFromProviderFormat(toolCalls: any[]): FunctionCall[] {
    return toolCalls.map(call => ({
      name: call.function.name,
      arguments: JSON.parse(call.function.arguments),
    }));
  }
}

class AnthropicLang extends LanguageProvider {
  protected convertToProviderFormat(functions: FunctionDefinition[]): any[] {
    return functions.map(f => ({
      name: f.name,
      description: f.description,
      input_schema: {
        type: "object",
        properties: this.convertParameters(f.parameters),
        required: this.getRequiredParameters(f.parameters),
      },
    }));
  }

  protected convertFromProviderFormat(toolCalls: any[]): FunctionCall[] {
    return toolCalls.map(call => ({
      name: call.name,
      arguments: call.arguments,
    }));
  }
}
```

Key differences we handle:
1. Request format differences:
   - OpenAI wraps functions in `type: "function"`
   - Anthropic uses `input_schema` instead of `parameters`
2. Response format differences:
   - OpenAI returns arguments as JSON string
   - Anthropic returns arguments as parsed object
3. Parameter naming differences:
   - OpenAI uses `function_call`
   - Anthropic uses `tool_choice`

## Function Call Handling

For handling function calls from the model, we'll add processing logic in each provider implementation to handle their specific streaming response formats.

### OpenAI Streaming Function Calls

OpenAI returns function calls as part of the delta streaming response with JSON strings for arguments that may be incomplete:

```typescript
// Example for OpenAI streaming function calls
const handleOpenAIStream = (data: any) => {
  // Existing streaming response handling...
  
  // Handle function calls
  if (data.choices && data.choices[0].delta.tool_calls) {
    const toolCall = data.choices[0].delta.tool_calls[0];
    
    // Initialize or update the function call in progress
    let currentFunctionCall = result.functionCalls?.find(f => f.name === toolCall.function.name);
    if (!currentFunctionCall) {
      currentFunctionCall = {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: {},
        rawArguments: "",
        provider: "openai"
      };
      result.functionCalls = [...(result.functionCalls || []), currentFunctionCall];
    }
    
    // OpenAI streams the arguments as a JSON string that may be incomplete
    // We need to accumulate the string and parse when complete
    if (toolCall.function.arguments) {
      currentFunctionCall.rawArguments += toolCall.function.arguments;
      
      try {
        // Try to parse the arguments as JSON
        const args = JSON.parse(currentFunctionCall.rawArguments);
        currentFunctionCall.arguments = args;
      } catch (e) {
        // Ignore parsing errors for incomplete JSON
      }
    }
    
    // Call the streaming callback with updated result
    if (onResult) {
      onResult(result);
    }
    
    // If function call is complete, execute the function if handler provided
    if (data.choices[0].finish_reason === "tool_calls" && functionHandler) {
      // Make sure we have valid arguments
      try {
        currentFunctionCall.arguments = JSON.parse(currentFunctionCall.rawArguments);
      } catch (e) {
        console.error("Failed to parse function arguments:", e);
      }
      
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
            arguments: currentFunctionCall.rawArguments
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

### Anthropic Streaming Function Calls

Anthropic sends complete tool calls in streaming responses, with arguments already parsed as objects:

```typescript
// Example for Anthropic streaming function calls
const handleAnthropicStream = (data: any) => {
  // Handle content blocks in streaming response
  if (data.delta?.content_blocks) {
    for (const block of data.delta.content_blocks) {
      // Check for tool_use blocks
      if (block.type === "tool_use") {
        // Anthropic provides complete tool calls with parsed arguments
        const toolCall = {
          id: block.id,
          name: block.tool_use.name,
          arguments: block.tool_use.input, // Already parsed as an object
          provider: "anthropic"
        };
        
        result.functionCalls = [...(result.functionCalls || []), toolCall];
        
        // Call the streaming callback with updated result
        if (onResult) {
          onResult(result);
        }
        
        // If function handler is provided and this is the end of the response
        if (data.delta.stop_reason === "tool_use" && functionHandler) {
          // Call the handler with the function call
          const functionResult = await functionHandler(toolCall);
          
          // Add function result to messages for the next request
          messages.push({
            role: "assistant",
            content: null,
            tool_uses: [{
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.arguments
            }]
          });
          
          messages.push({
            role: "tool",
            tool_use_id: toolCall.id,
            content: JSON.stringify(functionResult)
          });
          
          // Continue the conversation with the function result
          return this.chat(messages, options);
        }
      }
    }
  }
};
```

### Normalizing Function Calls

Each provider will implement its own normalization method in its derived class:

```typescript
// Base class provides the interface but doesn't implement provider-specific logic
abstract class LanguageProvider {
  // Abstract method that each provider must implement
  protected abstract normalizeFunctionCall(providerCall: any): FunctionCall;
  
  // Other common methods...
}

// OpenAI implementation
class OpenAILang extends LanguageProvider {
  protected normalizeFunctionCall(providerCall: any): FunctionCall {
    return {
      id: providerCall.id,
      name: providerCall.function.name,
      arguments: typeof providerCall.function.arguments === 'string' 
        ? JSON.parse(providerCall.function.arguments) 
        : providerCall.function.arguments,
      rawArguments: typeof providerCall.function.arguments === 'string' 
        ? providerCall.function.arguments 
        : JSON.stringify(providerCall.function.arguments),
      provider: "openai"
    };
  }
  
  // Other OpenAI-specific methods...
}

// Anthropic implementation
class AnthropicLang extends LanguageProvider {
  protected normalizeFunctionCall(providerCall: any): FunctionCall {
    return {
      id: providerCall.id,
      name: providerCall.name || providerCall.tool_use?.name,
      arguments: providerCall.arguments || providerCall.tool_use?.input,
      provider: "anthropic"
    };
  }
  
  // Other Anthropic-specific methods...
}
```

This approach keeps provider-specific logic encapsulated in the appropriate classes and follows the principle of having each class handle its own data format.

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

1. We use AIModels to check model capabilities:
```typescript
class LanguageProvider {
  protected modelInfo?: Model;

  constructor(modelName: string) {
    // Get model info from aimodels
    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid model: ${modelName}. Model not found in aimodels database.`);
    }
    this.modelInfo = modelInfo;
  }

  protected validateFunctionCalling(modelName: string): void {
    const modelInfo = models.id(modelName);
    
    // Only validate if we know about the model
    if (modelInfo) {
      const functionCallingModels = models.canCallFunctions();
      if (!functionCallingModels.includes(modelInfo)) {
        console.warn(`Model ${modelName} is known but does not support function calling. Supported models: ${functionCallingModels.map(m => m.name).join(", ")}`);
      }
    }
    // If we don't know about the model, we don't warn - it might be a new model
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangResult> {
    if (options?.model) {
      this.validateFunctionCalling(options.model);
    }
    // ... rest of implementation
  }
}
```

2. We only warn about function calling support if we know about the model in AIModels
3. Unknown models (not in AIModels) are allowed to proceed without warnings
4. The warning includes a list of known models that support function calling

## Multiple Function Calls

Modern language models can request multiple function calls in a single response. Here's how we'll handle this capability across providers:

### Sequential vs. Parallel Function Calls

#### Sequential Function Calls
Most commonly, function calls occur sequentially, where the model calls one function, receives the result, and then decides to call another function based on that result:

```typescript
// Model flow
1. Model: "I need the weather in San Francisco" → calls getCurrentWeather(location: "San Francisco")
2. Function returns: { temperature: 72, condition: "sunny" }
3. Model: "Now I need to know about local attractions" → calls getAttractions(city: "San Francisco")
```

#### Parallel Function Calls
Some providers (like OpenAI) support parallel function calling where the model can request multiple function calls at once:

```typescript
// OpenAI can return multiple tool_calls in a single response
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_123",
      "type": "function",
      "function": {
        "name": "getCurrentWeather",
        "arguments": "{\"location\":\"San Francisco\"}"
      }
    },
    {
      "id": "call_456",
      "type": "function",
      "function": {
        "name": "getAttractions",
        "arguments": "{\"city\":\"San Francisco\"}"
      }
    }
  ]
}
```

### Handling Multiple Function Calls

Our implementation will support both sequential and parallel function calls:

```typescript
// For providers supporting parallel calls (like OpenAI)
if (data.choices[0].finish_reason === "tool_calls" && functionHandler) {
  const toolCalls = data.choices[0].delta.tool_calls || [data.choices[0].delta.tool_calls[0]];
  
  // Process all tool calls in parallel
  const functionPromises = toolCalls.map(async (toolCall) => {
    const call = {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments || '{}'),
      provider: "openai"
    };
    
    // Call the handler
    const functionResult = await functionHandler(call);
    
    // Add to result's function calls history
    result.functionCalls = [...(result.functionCalls || []), call];
    
    // Return info needed for the next message
    return {
      id: toolCall.id,
      call,
      result: functionResult
    };
  });
  
  // Wait for all function calls to complete
  const functionResults = await Promise.all(functionPromises);
  
  // Add all function calls and results to the messages
  functionResults.forEach(({ id, call, result: functionResult }) => {
    // Add function call
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [{
        id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments)
        }
      }]
    });
    
    // Add function result
    messages.push({
      role: "tool",
      tool_call_id: id,
      content: JSON.stringify(functionResult)
    });
  });
  
  // Continue the conversation with all function results
  return this.chat(messages, options);
}
```

### Multiple Function Example

```typescript
import { Lang } from "aiwrapper";

// Define multiple functions
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
    },
  },
  {
    name: "getAttractions",
    description: "Get tourist attractions in a given city",
    parameters: {
      city: {
        type: "string",
        description: "The city name, e.g., San Francisco",
        required: true,
      },
      category: {
        type: "string",
        enum: ["museums", "parks", "restaurants", "historical"],
        description: "The category of attractions",
        required: false,
      },
    },
  },
];

// Initialize a model that supports function calling
const lang = Lang.openai({ apiKey: "YOUR KEY", model: "gpt-4-turbo" });

// Use multiple functions
const result = await lang.ask("I'm planning a trip to San Francisco. What's the weather like and what attractions should I visit?", { 
  functions, 
  functionHandler: async (call) => {
    // Handle different function calls
    if (call.name === "getCurrentWeather") {
      return { temperature: 72, unit: "fahrenheit", condition: "sunny" };
    }
    else if (call.name === "getAttractions") {
      const category = call.arguments.category || "all";
      return {
        attractions: [
          { name: "Golden Gate Bridge", category: "historical" },
          { name: "Alcatraz Island", category: "historical" },
          { name: "Fisherman's Wharf", category: "restaurants" },
          { name: "Golden Gate Park", category: "parks" }
        ].filter(a => category === "all" || a.category === category)
      };
    }
    return null;
  },
  onResult: (partialResult) => {
    console.log(partialResult.answer);
  }
});
```

## Advanced Features (Future Work)

1. Support for more advanced tool calling patterns
2. Tool-specific error handling
3. User-controlled function permissions
4. Conversion helpers between different providers' function calling formats
5. Debug mode for function calls
