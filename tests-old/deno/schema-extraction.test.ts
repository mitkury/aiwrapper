import { assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { buildPromptForSchema } from "../../src/lang/prompt-for-json.ts";

Deno.test("buildPromptForSchema - basic schema generation", () => {
  const instruction = "List all planets in the solar system";
  const schema = [{ name: "string", diameter: 0, type: "string" }];
  
  const prompt = buildPromptForSchema(instruction, schema);
  
  // Check that the prompt includes the instruction
  assertEquals(prompt.includes(instruction), true);
  
  // Check that the prompt includes the schema
  assertEquals(prompt.includes(JSON.stringify(schema, null, 2)), true);
  
  // Check that the prompt has the expected sections
  assertEquals(prompt.includes("## Task"), true);
  assertEquals(prompt.includes("## Output Format"), true);
  assertEquals(prompt.includes("## Output"), true);
  
  // Check that the prompt includes guidance about schema structure
  assertEquals(prompt.includes("follows this exact schema structure"), true);
});

Deno.test("buildPromptForSchema - object schema", () => {
  const instruction = "Get information about Earth";
  const schema = { 
    name: "string", 
    diameter: 0, 
    moons: 0, 
    details: { 
      surfaceArea: 0, 
      gravity: 0
    }
  };
  
  const prompt = buildPromptForSchema(instruction, schema);
  
  // Check that the prompt mentions it's an object (not an array)
  assertEquals(prompt.includes("an object that follows"), true);
  
  // Check that the nested structure is preserved
  assertEquals(prompt.includes('"details": {'), true);
  assertEquals(prompt.includes('"surfaceArea": 0'), true);
});

Deno.test("buildPromptForSchema - array schema", () => {
  const instruction = "List top 5 countries by population";
  const schema = [{ 
    name: "string", 
    population: 0, 
    capital: "string" 
  }];
  
  const prompt = buildPromptForSchema(instruction, schema);
  
  // Check that the prompt mentions it's an array
  assertEquals(prompt.includes("an array of objects that follows"), true);
});