// Test script for DeepSeek's reasoning model
// This tests the implementation of reasoning for DeepSeek reasoner model

import { Lang } from "../../dist/npm-entry.js";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testDeepSeekReasoning() {
  console.log("\n=== Testing DeepSeek Reasoning ===");
  
  // Get API key from environment variables
  const apiKey = process.env.DEEPSEEK_API_KEY;
  
  if (!apiKey) {
    console.error("❌ No DeepSeek API key found in .env file");
    return;
  }
  
  console.log("✓ Found DeepSeek API key");
  
  // Create a Lang instance with a model that supports reasoning
  // The reasoning capability will be detected automatically based on the model's capabilities
  const lang = Lang.deepseek({
    apiKey,
    model: 'deepseek-reasoner'
  });
  
  // Check if the model supports reasoning
  const modelInfo = lang.modelInfo;
  console.log(JSON.stringify(modelInfo, null, 2));
  console.log("Model supports reasoning:", modelInfo?.can?.includes("reason") || false);
  
  console.log("✓ Initialized DeepSeek provider with a reasoning-capable model");
  
  // A complex math problem that would benefit from reasoning
  const prompt = 'Solve this step by step: If a train travels at 120 km/h and another train travels at 80 km/h in the opposite direction, how long will it take for them to be 500 km apart if they start at the same location?';
  
  console.log("\nSending request to DeepSeek reasoner...");
  console.log("Prompt:", prompt);
  console.log("\nStreaming Response:");
  
  let callCount = 0;
  
  try {
    // Call the model with streaming to see the response as it's generated
    const result = await lang.ask(prompt, (result) => {
      callCount++;
      
      // Only log every 10th update to avoid flooding the console
      if (callCount % 10 === 0) {
        console.log(`Update #${callCount}:`);
        console.log(`- Answer length: ${result.answer.length}`);
        console.log(`- Has thinking: ${!!result.thinking}`);
        if (result.thinking) {
          console.log(`- Thinking length: ${result.thinking.length}`);
        }
      }
    });
    
    console.log("\n\nFinal answer:");
    console.log(result.answer);
    
    console.log("\nReasoning content:");
    console.log(result.thinking || "No reasoning content available");
    
    console.log("\nTotal streaming updates:", callCount);
    
    console.log("\n✓ Test completed successfully!");
    return true; // Return true to indicate success
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    throw error; // Re-throw the error to fail the test
  }
}

// Run the test
testDeepSeekReasoning().catch(console.error); 