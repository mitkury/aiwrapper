import { assertEquals } from "https://deno.land/std/testing/asserts.ts";
// @ts-ignore
import { Validator } from "npm:jsonschema";

// Create a mock class that exposes the validation methods for testing
class SchemaValidator {
  schemaToJsonSchema(schema: any): any {
    // Handle array schema
    if (Array.isArray(schema)) {
      if (schema.length === 0) {
        return {
          type: "array",
          items: {}
        };
      }
      
      // Use the first item as the template for array items
      return {
        type: "array",
        items: this.convertObjectToJsonSchema(schema[0])
      };
    }
    
    // Handle object schema
    return this.convertObjectToJsonSchema(schema);
  }
  
  convertObjectToJsonSchema(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return this.getTypeSchema(obj);
    }
    
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    Object.entries(obj).forEach(([key, value]) => {
      properties[key] = this.getPropertySchema(value);
      required.push(key);
    });
    
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false
    };
  }
  
  getPropertySchema(value: any): any {
    if (value === null) {
      return { type: "null" };
    }
    
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return { type: "array" };
      }
      
      return {
        type: "array",
        items: this.getPropertySchema(value[0])
      };
    }
    
    if (typeof value === 'object') {
      return this.convertObjectToJsonSchema(value);
    }
    
    return this.getTypeSchema(value);
  }
  
  getTypeSchema(value: any): any {
    switch (typeof value) {
      case 'string':
        return { type: "string" };
      case 'number':
        return { type: "number" };
      case 'boolean':
        return { type: "boolean" };
      default:
        return {};
    }
  }
  
  validateSchema(schema: any, target: any): { valid: boolean, errors: any[] } {
    const validator = new Validator();
    
    // Check if the schema is already in JSON Schema format
    const isJsonSchema = schema && typeof schema === 'object' && 
      (schema.type !== undefined || (schema.properties !== undefined && !Array.isArray(schema.properties)));
    
    const jsonSchema = isJsonSchema
      ? schema  // Already in JSON Schema format
      : this.schemaToJsonSchema(schema);  // Convert to JSON Schema
      
    const result = validator.validate(target, jsonSchema);
    
    return {
      valid: result.valid,
      errors: result.errors
    };
  }
}

// Test cases
Deno.test("Schema validation - simple object schema", () => {
  const validator = new SchemaValidator();
  
  const schema = {
    name: "string",
    age: 0
  };
  
  const validObject = {
    name: "John",
    age: 30
  };
  
  const invalidObject1 = {
    name: "John"
    // Missing age property
  };
  
  const invalidObject2 = {
    name: "John",
    age: "thirty" // Wrong type
  };
  
  const invalidObject3 = {
    name: "John",
    age: 30,
    extra: "field" // Extra field
  };
  
  // Test valid object
  const result1 = validator.validateSchema(schema, validObject);
  assertEquals(result1.valid, true);
  
  // Test missing property
  const result2 = validator.validateSchema(schema, invalidObject1);
  assertEquals(result2.valid, false);
  
  // Test wrong type
  const result3 = validator.validateSchema(schema, invalidObject2);
  assertEquals(result3.valid, false);
  
  // Test extra property
  const result4 = validator.validateSchema(schema, invalidObject3);
  assertEquals(result4.valid, false);
});

Deno.test("Schema validation - array schema", () => {
  const validator = new SchemaValidator();
  
  const schema = [
    {
      name: "string",
      value: 0
    }
  ];
  
  const validArray = [
    { name: "item1", value: 10 },
    { name: "item2", value: 20 }
  ];
  
  const invalidArray1 = [
    { name: "item1" } // Missing value
  ];
  
  const invalidArray2 = [
    { name: "item1", value: "10" } // Wrong type
  ];
  
  const invalidArray3 = "not an array"; // Not an array at all
  
  // Test valid array
  const result1 = validator.validateSchema(schema, validArray);
  assertEquals(result1.valid, true);
  
  // Test missing property in array item
  const result2 = validator.validateSchema(schema, invalidArray1);
  assertEquals(result2.valid, false);
  
  // Test wrong type in array item
  const result3 = validator.validateSchema(schema, invalidArray2);
  assertEquals(result3.valid, false);
  
  // Test not an array
  const result4 = validator.validateSchema(schema, invalidArray3);
  assertEquals(result4.valid, false);
});

Deno.test("Schema validation - nested objects", () => {
  const validator = new SchemaValidator();
  
  const schema = {
    name: "string",
    details: {
      age: 0,
      address: {
        city: "string",
        country: "string"
      }
    }
  };
  
  const validObject = {
    name: "John",
    details: {
      age: 30,
      address: {
        city: "New York",
        country: "USA"
      }
    }
  };
  
  const invalidObject = {
    name: "John",
    details: {
      age: 30,
      address: {
        city: "New York"
        // Missing country
      }
    }
  };
  
  // Test valid nested object
  const result1 = validator.validateSchema(schema, validObject);
  assertEquals(result1.valid, true);
  
  // Test missing nested property
  const result2 = validator.validateSchema(schema, invalidObject);
  assertEquals(result2.valid, false);
});

Deno.test("Schema to JSON Schema conversion", () => {
  const validator = new SchemaValidator();
  
  // Test simple object schema
  const simpleSchema = {
    name: "string",
    age: 0
  };
  
  const jsonSchema1 = validator.schemaToJsonSchema(simpleSchema);
  assertEquals(jsonSchema1.type, "object");
  assertEquals(jsonSchema1.properties.name.type, "string");
  assertEquals(jsonSchema1.properties.age.type, "number");
  assertEquals(jsonSchema1.required.includes("name"), true);
  assertEquals(jsonSchema1.required.includes("age"), true);
  
  // Test array schema
  const arraySchema = [
    {
      id: "string",
      count: 0
    }
  ];
  
  const jsonSchema2 = validator.schemaToJsonSchema(arraySchema);
  assertEquals(jsonSchema2.type, "array");
  assertEquals(jsonSchema2.items.type, "object");
  assertEquals(jsonSchema2.items.properties.id.type, "string");
  assertEquals(jsonSchema2.items.properties.count.type, "number");
});