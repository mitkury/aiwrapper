import { z } from 'zod';

/**
 * Type guard to check if a value is a Zod schema
 */
export function isZodSchema(schema: unknown): schema is z.ZodType {
  return schema !== null && 
         typeof schema === 'object' && 
         'parse' in schema && 
         'safeParse' in schema && 
         typeof (schema as z.ZodType).parse === 'function' && 
         typeof (schema as z.ZodType).safeParse === 'function';
}

/**
 * Type guard to check if a value is a JSON schema
 */
export function isJsonSchema(schema: unknown): schema is Record<string, unknown> {
  return schema !== null && 
         typeof schema === 'object' && 
         !isZodSchema(schema);
}

/**
 * Convert a Zod schema to a human-readable description for LLM prompts
 */
export function zodSchemaToDescription(schema: z.ZodType): string {
  // This is a simplified implementation
  // In a real implementation, we would recursively traverse the schema
  
  try {
    // Try to get the description from the schema metadata
    const description = schema.description;
    if (description) return description;
    
    // For simple types, return a basic description
    if (schema instanceof z.ZodString) return "a string";
    if (schema instanceof z.ZodNumber) return "a number";
    if (schema instanceof z.ZodBoolean) return "a boolean";
    if (schema instanceof z.ZodNull) return "null";
    if (schema instanceof z.ZodUndefined) return "undefined";
    
    // For arrays, describe the items
    if (schema instanceof z.ZodArray) {
      const itemSchema = schema._def.type;
      return `an array of ${zodSchemaToDescription(itemSchema)}`;
    }
    
    // For objects, describe the properties
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties = Object.entries(shape).map(([key, valueSchema]) => {
        return `${key}: ${zodSchemaToDescription(valueSchema as z.ZodType)}`;
      });
      
      return `an object with properties: { ${properties.join(", ")} }`;
    }
    
    // For other types, use JSON.stringify as a fallback
    return JSON.stringify(schema);
  } catch (error) {
    // Fallback to a generic description
    return "a value matching the provided schema";
  }
}

/**
 * Convert a JSON schema to a human-readable description for LLM prompts
 */
export function jsonSchemaToDescription(schema: Record<string, unknown>): string {
  // This is a simplified implementation
  // In a real implementation, we would recursively traverse the schema
  
  try {
    const type = schema.type as string;
    
    if (type === "string") return "a string";
    if (type === "number" || type === "integer") return "a number";
    if (type === "boolean") return "a boolean";
    if (type === "null") return "null";
    
    if (type === "array" && schema.items) {
      const itemSchema = schema.items as Record<string, unknown>;
      return `an array of ${jsonSchemaToDescription(itemSchema)}`;
    }
    
    if (type === "object" && schema.properties) {
      const properties = Object.entries(schema.properties as Record<string, Record<string, unknown>>)
        .map(([key, valueSchema]) => {
          return `${key}: ${jsonSchemaToDescription(valueSchema)}`;
        });
      
      return `an object with properties: { ${properties.join(", ")} }`;
    }
    
    // For other types, use JSON.stringify as a fallback
    return JSON.stringify(schema);
  } catch (error) {
    // Fallback to a generic description
    return "a value matching the provided schema";
  }
}

/**
 * Convert any schema (Zod or JSON) to a human-readable description
 */
export function schemaToDescription(schema: unknown): string {
  if (isZodSchema(schema)) {
    return zodSchemaToDescription(schema);
  } else if (isJsonSchema(schema)) {
    return jsonSchemaToDescription(schema);
  } else {
    return "a value matching the provided schema";
  }
}

/**
 * Validate a value against a schema (Zod or JSON)
 */
export function validateAgainstSchema(value: unknown, schema: unknown): { valid: boolean, errors: string[] } {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(value);
    if (result.success) {
      return { valid: true, errors: [] };
    } else {
      return { 
        valid: false, 
        errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
      };
    }
  } else if (isJsonSchema(schema)) {
    // Simple validation for JSON Schema
    // In a real implementation, we would use a proper JSON Schema validator
    try {
      const type = schema.type as string;
      
      if (type === "string" && typeof value !== "string") {
        return { valid: false, errors: ["Expected a string"] };
      }
      
      if ((type === "number" || type === "integer") && typeof value !== "number") {
        return { valid: false, errors: ["Expected a number"] };
      }
      
      if (type === "boolean" && typeof value !== "boolean") {
        return { valid: false, errors: ["Expected a boolean"] };
      }
      
      if (type === "null" && value !== null) {
        return { valid: false, errors: ["Expected null"] };
      }
      
      if (type === "array" && !Array.isArray(value)) {
        return { valid: false, errors: ["Expected an array"] };
      }
      
      if (type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
        return { valid: false, errors: ["Expected an object"] };
      }
      
      return { valid: true, errors: [] };
    } catch (_error) {
      return { valid: false, errors: ["Invalid schema or value"] };
    }
  } else {
    return { valid: false, errors: ["Invalid schema"] };
  }
}
