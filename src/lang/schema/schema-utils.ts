import { z } from 'zod';
import { zodToJsonSchema as zodToJsonSchemaPkg } from 'zod-to-json-schema';
import Ajv, { ErrorObject } from 'ajv';

// Lazy singleton Ajv instance to avoid repeated construction
let ajvInstance: Ajv | null = null;
function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: true, strict: false });
  }
  return ajvInstance;
}

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
      const ajv = getAjv();
      const validate = ajv.compile(schema);
      const ok = validate(value);
      if (ok) {
        return { valid: true, errors: [] };
      }
      const errors: ErrorObject[] | null | undefined = validate.errors;
      const messages = (errors || []).map(e => {
        const instancePath = e.instancePath || '';
        const path = instancePath.startsWith('/') ? instancePath.slice(1).replace(/\//g, '.') : instancePath;
        const msg = e.message || 'validation error';
        return path ? `${path}: ${msg}` : msg;
      });
      return { valid: false, errors: messages };
    } catch (_error) {
      return { valid: false, errors: ["Invalid JSON Schema or value"] };
    }
  } else {
    return { valid: false, errors: ["Invalid schema"] };
  }
}

/**
 * Convert a subset of Zod schemas to JSON Schema (sufficient for common cases)
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchemaPkg(schema) as unknown as Record<string, unknown>;
}
