// Simple test script to verify the Lang.models getter with the updated implementation
import { Lang } from './dist/npm-entry.js';

console.log("=== Testing Lang.models getter ===");

// First access to models
console.log("\nFirst models access:");
const firstModelsAccess = Lang.models;
console.log(`- Found ${firstModelsAccess.length} chat-capable models`);
console.log(`- Lang.models is instance of Array: ${Lang.models instanceof Array}`);

// Verify models have expected properties
const sampleModel = firstModelsAccess[0];
console.log(`\nSample model (${sampleModel.id}):`);
console.log(`- Provider: ${sampleModel.provider}`);
console.log(`- Context window: ${sampleModel.context?.max || 'unknown'}`);

// Demonstrate that each call returns a fresh instance
console.log("\nVerifying dynamic nature of getter:");
console.log(`- First access === second access: ${Lang.models === Lang.models}`);
console.log("- This should be false, showing the getter returns a new instance each time");

// Test using the models collection for filtering
console.log("\nFiltering models example:");
const bigContextModels = Lang.models.filter(model => 
  model.context?.max && model.context.max >= 32000
);
console.log(`- Found ${bigContextModels.length} models with context window >= 32k tokens`);

console.log("\nTest completed successfully!"); 