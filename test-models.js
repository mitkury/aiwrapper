// Simple test script to verify the Lang.models property with the updated aimodels package
import { Lang } from './dist/npm-entry.js';

console.log("=== Testing Lang.models with updated aimodels package ===");
console.log("Lang.models is defined:", Lang.models !== undefined);

// Log the number of chat models available
const models = Lang.models;
console.log(`Number of chat models available: ${models.length}`);

// Log the first few models
console.log("First few models:", models.slice(0, 5));

// Check if specific providers are in the list
const hasOpenAI = models.some(model => model.providers?.includes('openai'));
const hasAnthropic = models.some(model => model.providers?.includes('anthropic'));
const hasGroq = models.some(model => model.providers?.includes('groq'));

console.log("Has OpenAI models:", hasOpenAI);
console.log("Has Anthropic models:", hasAnthropic);
console.log("Has Groq models:", hasGroq);

console.log("=== Test completed ==="); 