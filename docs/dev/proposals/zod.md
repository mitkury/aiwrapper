# AIWrapper Zod Integration Proposal

*May 11, 2025*

## Overview

This document proposes integrating [Zod](https://github.com/colinhacks/zod) as the schema validation library for AIWrapper, replacing the current JSON Schema approach. This change will provide stronger type safety, better developer experience, and more reliable validation for structured data extraction from LLMs.

## Key Benefits

1. **Type Safety**: Zod provides full TypeScript integration with static type inference
2. **Simplified API**: More intuitive schema definition using TypeScript-like syntax
3. **Better Error Messages**: Detailed validation errors for easier debugging
4. **Smaller Bundle Size**: Zod is more lightweight than JSON Schema validators
5. **Modern Approach**: Aligns with current TypeScript ecosystem best practices

## Proposed API

### Flexible Schema Support

The API will support both Zod schemas and traditional JSON Schema objects with automatic detection:

```typescript
import { Lang, z } from "aiwrapper";

const lang = Lang.openai({ apiKey: "YOUR_API_KEY" });

// Option 1: Define a schema using Zod
const planetSchemaZod = z.array(
  z.object({
    name: z.string(),
    diameter: z.number(),
    unit: z.string()
  })
);

// Type is inferred from the schema
type Planet = z.infer<typeof planetSchemaZod>;

// Get structured data with Zod schema
const resultZod = await lang.askForObject(
  "List the planets in our solar system with their diameters",
  planetSchemaZod
);

// Option 2: Use traditional JSON Schema (for backward compatibility)
const planetSchemaJSON = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      diameter: { type: "number" },
      unit: { type: "string" }
    },
    required: ["name", "diameter", "unit"]
  }
};

// Works with JSON Schema too
const resultJSON = await lang.askForObject(
  "List the planets in our solar system with their diameters",
  planetSchemaJSON
);

// result.object is typed as Planet[]
console.log(result.object);
```

### Advanced Schema Features

```typescript
// Complex nested schema with validation rules
const userSchema = z.object({
  id: z.string().uuid(),
  name: z.object({
    first: z.string().min(2).max(50),
    last: z.string().min(2).max(50)
  }),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
  role: z.enum(["admin", "user", "guest"]),
  metadata: z.record(z.string(), z.unknown())
});

// Use with conversation history
const result = await lang.ask("Tell me about user John Doe");
result.addUserMessage("Format the user data as JSON");

const userResult = await lang.askForObject(
  result.messages,
  userSchema
);

// Strongly typed result
const user = userResult.object;
```

### Tool Integration

```typescript
// Define tool parameters with Zod
const weatherTool = {
  name: "getWeather",
  description: "Get the current weather for a location",
  parameters: z.object({
    location: z.string().describe("The city and state, e.g. San Francisco, CA"),
    units: z.enum(["celsius", "fahrenheit"]).optional().default("celsius")
  })
};

// Tool results are validated against their schema
const weatherResult = await lang.ask(
  "What's the weather in New York and Los Angeles?", 
  { tools: [weatherTool] }
);

// Tool parameters are properly typed
if (weatherResult.tools) {
  for (const tool of weatherResult.tools) {
    // tool.arguments is typed according to the schema
    const location = tool.arguments.location; // string
    const units = tool.arguments.units; // "celsius" | "fahrenheit" | undefined
  }
}
```

## Implementation Plan

1. **Add Zod Dependency**: Add Zod as a dependency to the project
2. **Create Schema Detection**: Implement logic to detect whether a schema is a Zod schema or JSON Schema
3. **Create Schema Adapters**: Build adapter layers to handle both schema types:
   - Zod schema to LLM-compatible format
   - JSON Schema to LLM-compatible format
   - Validation logic for both schema types
4. **Update Core Classes**: Modify `LanguageProvider` and `LangResult` to work with both schema types
5. **Optimize Type Inference**: Ensure proper TypeScript type inference for both approaches
6. **Update Documentation**: Create comprehensive examples for both schema types
7. **Add Tests**: Ensure all schema validation scenarios are covered for both approaches

## Breaking Changes

This proposal introduces a clean break from the previous API while still supporting both schema types:

1. **New API Structure**: Redesign the API to better support both schema types
2. **Breaking Changes Allowed**: Make breaking changes where necessary for a better design
3. **Support Both Formats**: Allow both Zod and JSON Schema objects to be passed
4. **Schema Detection**: Automatically detect which schema type is being used
5. **Improved Type Safety**: Leverage TypeScript's type system more effectively
6. **Version Strategy**: Introduce in the next major version (breaking change)

## Performance Considerations

Zod is generally more performant than most JSON Schema validators, but we should benchmark the following:

1. **Validation Speed**: Especially for large, complex objects
2. **Bundle Size Impact**: Ensure minimal increase in package size
3. **Memory Usage**: Monitor memory usage during validation

## Schema Detection Implementation

The schema detection logic would work as follows:

```typescript
function isZodSchema(schema: unknown): schema is ZodSchema {
  // Check if it's a Zod schema object
  return schema !== null && 
         typeof schema === 'object' && 
         'parse' in schema && 
         'safeParse' in schema && 
         typeof schema.parse === 'function' && 
         typeof schema.safeParse === 'function';
}

async function askForObject<T>(prompt: string, schema: unknown): Promise<LangResult> {
  if (isZodSchema(schema)) {
    // Handle as Zod schema
    return processZodSchema(prompt, schema);
  } else {
    // Handle as JSON Schema
    return processJSONSchema(prompt, schema);
  }
}
```

## Example Usage Comparison

### JSON Schema Approach

```typescript
// Traditional JSON Schema
const planetSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      diameter: { type: "number" },
      unit: { type: "string" }
    },
    required: ["name", "diameter", "unit"]
  }
};

// Works with existing code
const result = await lang.askForObject(prompt, planetSchema);
```

### Zod Approach

```typescript
// Modern Zod schema with better type inference
const planetSchema = z.array(
  z.object({
    name: z.string(),
    diameter: z.number(),
    unit: z.string()
  })
);

// Same API, better TypeScript integration
const result = await lang.askForObject(prompt, planetSchema);
// result.object is now properly typed as Array<{name: string, diameter: number, unit: string}>
```

## Technical Considerations

### Schema Conversion

Both schema types need to be converted to a format that LLMs can understand:

1. **Zod to Prompt Format**: Convert Zod schemas to human-readable descriptions
2. **JSON Schema to Prompt Format**: Convert JSON Schema to human-readable descriptions
3. **Validation**: Apply the appropriate validation based on schema type

### Type Inference

One key advantage of Zod is its superior type inference:

```typescript
// With JSON Schema, type information is lost
const result1 = await lang.askForObject(prompt, jsonSchema);
// result1.object is typed as 'any'

// With Zod, type information is preserved
const result2 = await lang.askForObject(prompt, zodSchema);
// result2.object is properly typed based on the Zod schema
const planets = result2.object; // typed as Array<{name: string, diameter: number, unit: string}>
```

## Conclusion

Supporting both Zod and JSON Schema with automatic detection provides the best of both worlds:

1. **Backward Compatibility**: Existing code continues to work without changes
2. **Modern Developer Experience**: New code can leverage Zod's superior type safety
3. **Flexibility**: Developers can choose the approach that works best for their use case
4. **Gradual Adoption**: Teams can migrate to Zod at their own pace

This approach aligns with AIWrapper's philosophy of being flexible and developer-friendly while embracing modern TypeScript practices.
