import zodToJsonSchema from "zod-to-json-schema";
import { LangResponseSchema } from "./language-provider";
import { isZodSchema } from "./schema/schema-utils";

/**
 * Generate a prompt for extracting structured data based on a schema
 * This is a fallback for LLMs that don't support structured output in their API.
 * For example, we use it with Anthropic.
 * @param prompt The instruction for the LLM (e.g., "List all planets with their diameters")
 * @param schema The schema that the output should conform to
 * @returns A formatted prompt string
 */
export function addInstructionAboutSchema(schema: LangResponseSchema): string {
  let schemaStr = '';
  if (isZodSchema(schema)) {
    const jsonSchema = zodToJsonSchema(schema);
    schemaStr = JSON.stringify(jsonSchema, null, 2);
  } else {
    schemaStr = JSON.stringify(schema, null, 2);
  }

  return `<outputFormat>
  You must return a valid JSON that follows this exact schema structure:
  \`\`\`json
  ${schemaStr}
  \`\`\`

  Don't include any text outside the JSON.
</outputFormat>`;
}