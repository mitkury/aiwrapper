import { Lang } from "../../mod.ts";
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

// Load environment variables
await config({ export: true });

// Get OpenAI API key from environment
const apiKey = Deno.env.get("OPENAI_API_KEY");
if (!apiKey) {
  console.error("❌ OPENAI_API_KEY environment variable not set");
  Deno.exit(1);
}

async function testSchemaTypes() {
  console.log("\n=== Testing Schema Types with OpenAI ===\n");
  const lang = Lang.openai({ apiKey: apiKey as string, model: "gpt-3.5-turbo" });

  // Test 1: Simple schema with primitive types
  console.log("Test 1: Simple schema with primitive types");
  const simpleSchema = {
    name: "string",
    age: 0,
    isActive: true
  };

  try {
    const result1 = await lang.askForObject(
      "Generate information for a fictional person named Alex who is 28 years old and active.",
      simpleSchema
    );
    console.log("Simple schema result:", result1.object);
  } catch (error) {
    console.error("❌ Simple schema test failed:", error);
  }

  // Test 2: Array schema
  console.log("\nTest 2: Array schema");
  const arraySchema = [
    {
      name: "string",
      specialty: "string"
    }
  ];

  try {
    const result2 = await lang.askForObject(
      "List 3 types of doctors and their specialties.",
      arraySchema
    );
    console.log("Array schema result:", result2.object);
  } catch (error) {
    console.error("❌ Array schema test failed:", error);
  }

  // Test 3: Nested object schema
  console.log("\nTest 3: Nested object schema");
  const nestedSchema = {
    name: "string",
    contact: {
      email: "string",
      phone: "string"
    },
    addresses: [
      {
        type: "string",
        street: "string",
        city: "string"
      }
    ]
  };

  try {
    const result3 = await lang.askForObject(
      "Generate contact information for a fictional business.",
      nestedSchema
    );
    console.log("Nested schema result:", result3.object);
  } catch (error) {
    console.error("❌ Nested schema test failed:", error);
  }

  // Test 4: Direct JSON Schema format
  console.log("\nTest 4: Direct JSON Schema format");
  const jsonSchema = {
    type: "object",
    properties: {
      title: { type: "string" },
      year: { type: "number" },
      genres: { 
        type: "array", 
        items: { type: "string" } 
      }
    },
    required: ["title", "year", "genres"]
  };

  try {
    const result4 = await lang.askForObject(
      "Describe a popular science fiction movie from the 1980s.",
      jsonSchema
    );
    console.log("JSON Schema format result:", result4.object);
  } catch (error) {
    console.error("❌ JSON Schema format test failed:", error);
  }
}

await testSchemaTypes(); 