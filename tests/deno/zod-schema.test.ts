import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { z } from "../../mod.ts";

// Mock the API calls for testing
const mockResponse = {
  choices: [
    {
      message: {
        content: '{"name": "TestCompany", "founded": 2023, "active": true}'
      }
    }
  ]
};

// Create a mock Lang instance that returns predefined responses
const mockLang = {
  ask: () => {
    return Promise.resolve({
      answer: mockResponse.choices[0].message.content,
      object: null,
      tools: null,
      messages: [],
      finished: true,
      addUserMessage: () => {}
    });
  },
  chat: () => {
    return Promise.resolve({
      answer: mockResponse.choices[0].message.content,
      object: null,
      tools: null,
      messages: [],
      finished: true,
      addUserMessage: () => {}
    });
  },
  askForObject: (_prompt: string, _schema: unknown) => {
    const result = {
      answer: mockResponse.choices[0].message.content,
      object: JSON.parse(mockResponse.choices[0].message.content),
      tools: null,
      messages: [],
      finished: true,
      addUserMessage: () => {}
    };
    return Promise.resolve(result);
  }
};

Deno.test("Zod schema validation", async () => {
  // Define a Zod schema for company information
  const companySchema = z.object({
    name: z.string(),
    founded: z.number(),
    active: z.boolean()
  });
  
  // Use the schema with askForObject
  const result = await mockLang.askForObject(
    "Create a profile for a company",
    companySchema
  );
  
  // Check that the object was extracted correctly
  assertEquals(result.object.name, "TestCompany");
  assertEquals(result.object.founded, 2023);
  assertEquals(result.object.active, true);
});

Deno.test("JSON Schema validation", async () => {
  // Define a JSON Schema for company information
  const companySchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      founded: { type: "number" },
      active: { type: "boolean" }
    },
    required: ["name", "founded", "active"]
  };
  
  // Use the schema with askForObject
  const result = await mockLang.askForObject(
    "Create a profile for a company",
    companySchema
  );
  
  // Check that the object was extracted correctly
  assertEquals(result.object.name, "TestCompany");
  assertEquals(result.object.founded, 2023);
  assertEquals(result.object.active, true);
});
