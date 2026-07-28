import type { LangResponseSchema } from "./language-provider.js";
import { isZodSchema, zodToJsonSchema } from "./schema/schema-utils.js";

export function combineInstructions(
  ...instructions: Array<string | undefined>
): string {
  return instructions
    .filter((instruction): instruction is string =>
      typeof instruction === "string" && instruction.length > 0
    )
    .join("\n\n");
}

/**
 * Generate a prompt for extracting structured data based on a schema
 * This is a fallback for LLMs that don't support structured output in their API.
 * For example, we use it with Anthropic.
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
