// Test script for OpenAI's thinking capability
// NOTE: This test is commented out because OpenAI doesn't expose thinking/reasoning in their API yet
// This file is a placeholder for when OpenAI adds this capability

/*
import { Lang } from "../../dist/npm-entry.js";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testOpenAIThinking() {
  console.log("\n=== Testing OpenAI Thinking ===");
  
  // Get API key from environment variables
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error("❌ No OpenAI API key found in .env file");
    return;
  }
  
  console.log("✓ Found OpenAI API key");
  
  // Create a Lang instance with thinking enabled
  // Note: This is a placeholder for when OpenAI adds this capability
  const lang = Lang.openai({
    apiKey,
    model: 'gpt-4o',
    // enableThinking: true  // This option doesn't exist yet
  });
  
  console.log("✓ Initialized OpenAI provider");
  
  // A complex math problem that would benefit from thinking
  const prompt = 'Solve this step by step: If a train travels at 120 km/h and another train travels at 80 km/h in the opposite direction, how long will it take for them to be 500 km apart if they start at the same location?';
  
  console.log("\nSending request to OpenAI...");
  console.log("Prompt:", prompt);
  console.log("\nResponse:");
  
  try {
    // Call the model with streaming to see the response as it's generated
    const result = await lang.ask(prompt, (result) => {
      // Print progress indicator
      process.stdout.write(".");
    });
    
    console.log("\n\nFinal answer:");
    console.log(result.answer);
    
    // This would show thinking content if OpenAI exposed it
    console.log("\nThinking content (not available yet):");
    console.log(result.thinking || "OpenAI doesn't expose thinking content yet");
    
    console.log("\n✓ Test completed successfully!");
    return true; // Return true to indicate success
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    throw error; // Re-throw the error to fail the test
  }
}

// This test is commented out because OpenAI doesn't expose thinking/reasoning in their API yet
// testOpenAIThinking().catch(console.error);
*/

console.log("OpenAI thinking test is disabled because OpenAI doesn't expose thinking/reasoning in their API yet."); 