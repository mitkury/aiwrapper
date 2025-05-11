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
    try {
      // @TODO: implement
      
      return { valid: true, errors: [] };
    } catch (_error) {
      return { valid: false, errors: ["Invalid schema or value"] };
    }
  } else {
    return { valid: false, errors: ["Invalid schema"] };
  }
}
