/**
 * Generate a prompt for extracting structured data based on a schema
 * This is a fallback for LLMs that don't support structured output
 * 
 * @param prompt The instruction for the LLM (e.g., "List all planets with their diameters")
 * @param schema The schema that the output should conform to
 * @returns A formatted prompt string
 */
export function addInstructionAboutSchema(prompt: string, schema: object | object[]): string {
  // Format the schema as a JSON string with proper indentation
  const schemaJson = JSON.stringify(schema, null, 2);
  const schemaType = Array.isArray(schema) ? "an array" : "an object";
  
  return `${prompt}

## IMPORTANT
You must return a valid JSON (${schemaType}) that follows this exact schema structure:
\`\`\`json
${schemaJson}
\`\`\`

Don't include any text outside the JSON.

## Output
\`\`\`json`;
}