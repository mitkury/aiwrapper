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
// WHAT HAPPENS INSIDE THE LIBRARY (not seen by users)
// Each provider class extends the base LanguageProvider class and implements
// its own processProviderResponse method to handle provider-specific formats

// In OpenAILang class
protected processStreamingResponse(chunk: any): void {
  // Handle text responses
  if (chunk.choices?.[0]?.delta?.content) {
    this.result.answer += chunk.choices[0].delta.content;
    this.triggerOnResult();
  }
  
  // Handle function calls - OpenAI specific format
  if (chunk.choices?.[0]?.delta?.tool_calls) {
    // Get the tool calls from the OpenAI response
    const openaiToolCalls = chunk.choices[0].delta.tool_calls;
    
    // Convert OpenAI's format to our standardized format
    openaiToolCalls.forEach(toolCall => {
      // Find or create a function call entry
      let functionCall = this.result.functionCalls?.find(fc => fc.id === toolCall.id);
      if (!functionCall) {
        functionCall = {
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: {},
          provider: "openai"
        };
        this.result.functionCalls = [...(this.result.functionCalls || []), functionCall];
      }
      
      // Accumulate arguments (OpenAI sends them in chunks)
      if (toolCall.function?.arguments) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          functionCall.arguments = { ...functionCall.arguments, ...args };
        } catch (e) {
          // Ignore partial JSON
        }
      }
    });
    
    this.triggerOnResult();
  }
  
  // Handle function call completion
  if (chunk.choices?.[0]?.finish_reason === "tool_calls" && this.options?.functionHandler) {
    this.handleFunctionCalls();
  }
}

// In AnthropicLang class
protected processStreamingResponse(chunk: any): void {
  // Handle text responses
  if (chunk.delta?.text) {
    this.result.answer += chunk.delta.text;
    this.triggerOnResult();
  }
  
  // Handle function calls - Anthropic specific format
  if (chunk.delta?.tool_use) {
    // Anthropic provides complete tool calls in one go
    const anthropicToolUse = chunk.delta.tool_use;
    
    // Convert Anthropic's format to our standardized format
    const functionCall = {
      id: chunk.delta.tool_use_id || `tool_${Date.now()}`,
      name: anthropicToolUse.name,
      arguments: anthropicToolUse.input, // Already an object in Anthropic
      provider: "anthropic"
    };
    
    this.result.functionCalls = [...(this.result.functionCalls || []), functionCall];
    this.triggerOnResult();
  }
  
  // Handle function call completion
  if (chunk.delta?.stop_reason === "tool_use" && this.options?.functionHandler) {
    this.handleFunctionCalls();
  }
}

// Common code in the base LanguageProvider class
// This is shared across all providers
protected async handleFunctionCalls(): Promise<void> {
  // Get all function calls that haven't been handled yet
  const pendingCalls = this.result.functionCalls?.filter(call => !call.handled) || [];
  
  if (pendingCalls.length === 0) return;
  
  // Process all function calls in parallel
  const functionPromises = pendingCalls.map(async (call) => {
    // Mark as handled to prevent duplicate processing
    call.handled = true;
    
    // Call the user-provided handler
    try {
      const result = await this.options.functionHandler(call);
      return { call, result };
    } catch (error) {
      console.error(`Error executing function ${call.name}:`, error);
      return { 
        call, 
        result: { error: `Error executing function: ${error.message}` } 
      };
    }
  });
  
  // Wait for all function calls to complete
  const results = await Promise.all(functionPromises);
  
  // Add the results to the message history and continue the conversation
  // Each provider class implements addFunctionResultsToMessages differently
  this.addFunctionResultsToMessages(results);
  
  // Continue the conversation
  this.continueConversation();
}
```

### Provider-Agnostic Function Calling Example

The key advantage of our abstraction is that it provides a unified interface for function calling across all supported providers (OpenAI, Anthropic, etc.) without exposing provider-specific implementation details. Here's how it works in practice:

```typescript
import { Lang } from "aiwrapper";
import axios from "axios";

// 1. Define your function implementations
async function getWeather(location) {
  // This would call a real weather API in production
  console.log(`Getting weather for ${location}...`);
  
  // Simulated API call
  return {
    temperature: 72,
    condition: "sunny",
    humidity: 45,
    wind: 8,
    unit: "fahrenheit"
  };
}

async function getAttractions(city, category = "all") {
  // This would query a tourism database or API in production
  console.log(`Getting ${category} attractions for ${city}...`);
  
  const attractions = [
    { name: "Golden Gate Bridge", category: "historical" },
    { name: "Alcatraz Island", category: "historical" },
    { name: "Fisherman's Wharf", category: "restaurants" },
    { name: "Golden Gate Park", category: "parks" }
  ];
  
  return {
    attractions: category === "all" 
      ? attractions 
      : attractions.filter(a => a.category === category)
  };
}

// 2. Define function definitions using our standard schema
// The same definitions work for ANY provider that supports function calling
const functions = [
  {
    name: "getWeather",
    description: "Get the current weather in a location",
    parameters: {
      location: {
        type: "string",
        description: "The city and state, e.g., San Francisco, CA",
        required: true,
      }
    }
  },
  {
    name: "getAttractions",
    description: "Get tourist attractions in a city",
    parameters: {
      city: {
        type: "string",
        description: "The city name, e.g., San Francisco",
        required: true,
      },
      category: {
        type: "string",
        enum: ["all", "museums", "parks", "restaurants", "historical"],
        description: "The category of attractions",
        required: false,
      }
    }
  }
];

// 3. This code works with ANY supported provider
async function runWithAnyProvider(providerName, apiKey) {
  // The beauty of our abstraction: initialize ANY provider that supports functions
  // Use the exact same code with different providers
  let lang;
  
  if (providerName === "openai") {
    lang = Lang.openai({ apiKey, model: "gpt-4-turbo" });
  } 
  else if (providerName === "anthropic") {
    lang = Lang.anthropic({ apiKey, model: "claude-3-opus-20240229" });
  }
  else if (providerName === "groq") {
    lang = Lang.groq({ apiKey, model: "llama3-groq-8b-8192" });
  }
  else {
    throw new Error(`Provider ${providerName} not supported`);
  }
  
  // 4. Use the same function calling interface across all providers
  // Our library handles all the provider-specific transformations 
  const result = await lang.ask(
    "I'm planning a trip to San Francisco. What's the weather like and what attractions should I visit?",
    {
      // Same function definitions for all providers
      functions,
      
      // Same function handler for all providers
      functionHandler: async (call) => {
        console.log(`Function called: ${call.name}`, call.arguments);
        
        // The function calls come in a standard format regardless of provider
        if (call.name === "getWeather") {
          return await getWeather(call.arguments.location);
        }
        else if (call.name === "getAttractions") {
          return await getAttractions(
            call.arguments.city, 
            call.arguments.category || "all"
          );
        }
        
        return { error: `Unknown function: ${call.name}` };
      },
      
      // The onResult format is the same across providers
      onResult: (partialResult) => {
        // Function calls appear in the same format for all providers
        if (partialResult.functionCalls && partialResult.functionCalls.length > 0) {
          // This functions the same way regardless of provider
          console.log("Function calls so far:", partialResult.functionCalls.length);
        }
        
        // Streaming happens the same way for all providers
        if (partialResult.answer) {
          console.log("Partial answer:", partialResult.answer);
        }
      }
    }
  );
  
  console.log("\nFinal answer:", result.answer);
  
  return result;
}

// 5. Try with different providers
async function main() {
  // Try with OpenAI
  console.log("Running with OpenAI:");
  await runWithAnyProvider("openai", "YOUR_OPENAI_KEY");
  
  // Try with Anthropic - THE EXACT SAME CODE WORKS
  console.log("\nRunning with Anthropic:");
  await runWithAnyProvider("anthropic", "YOUR_ANTHROPIC_KEY");
  
  // Try with another provider - THE EXACT SAME CODE WORKS
  console.log("\nRunning with another provider:");
  await runWithAnyProvider("groq", "YOUR_GROQ_KEY");
}

main().catch(console.error);
```

This example illustrates how our abstraction works:

1. **Define Functions Once**: Define your functions and their schemas in a standard format
2. **Use Any Provider**: Use any provider that supports function calling with the exact same code
3. **No Provider-Specific Logic**: You don't need to write different code for OpenAI vs Anthropic
4. **Consistent Response Format**: The results and function calls are returned in a consistent format

Under the hood, our library handles:
- Converting function definitions to each provider's specific format (OpenAI tools, Anthropic tools, etc.)
- Normalizing function calls from each provider into a standard format
- Managing the conversation flow and function call execution
- Providing the right message format for each provider's API

The beauty of this approach is that you can switch providers without changing your code. If a newer, better provider comes along, you can just change one line to use it instead.
```

## Advanced Features (Future Work)

1. Support for more advanced tool calling patterns
2. Tool-specific error handling
3. User-controlled function permissions
4. Conversion helpers between different providers' function calling formats
5. Debug mode for function calls
