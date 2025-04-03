/**
 * Simplified approach to generate structured output
 * Instead of examples, use the schema directly
 */

export type SchemaType = object | object[];

/**
 * Generate a prompt for extracting structured data based on a schema
 * 
 * @param instruction The instruction for the LLM (e.g., "List all planets with their diameters")
 * @param schema The schema that the output should conform to
 * @returns A formatted prompt string
 */
export function buildPromptForSchema(instruction: string, schema: SchemaType): string {
  // Format the schema as a JSON string with proper indentation
  const schemaJson = JSON.stringify(schema, null, 2);
  const schemaType = Array.isArray(schema) ? "an array of objects" : "an object";
  
  return `# Extract Structured Data

## Task
${instruction}

## Output Format
You must return a valid JSON ${schemaType} that follows this exact schema structure:
\`\`\`json
${schemaJson}
\`\`\`

This schema is not an example - it shows the required structure and property types your output must have.
Your response must be valid JSON that conforms to this schema. Don't include any text outside the JSON.

## Output
\`\`\`json`;
}

// Keep the old format for backward compatibility
export type PromptForObject = {
  title?: string;
  description?: string;
  instructions: string[];
  objectExamples: object[];
  content?: {
    [key: string]: string;
  };
};

export function buildPromptForGettingJSON(prompt: PromptForObject): string {
  // Create a simpler prompt using the first instruction and first example as the schema
  const instruction = prompt.instructions.length > 0 
    ? prompt.instructions[0] 
    : "Extract structured data";
  
  const schema = prompt.objectExamples.length > 0 
    ? prompt.objectExamples[0] 
    : {};
  
  return buildPromptForSchema(instruction, schema);
}
