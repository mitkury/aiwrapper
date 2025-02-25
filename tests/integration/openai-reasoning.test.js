// Test script for OpenAI's reasoning model
// This tests the basic functionality of OpenAI models with step-by-step reasoning

import { Lang } from "../../dist/npm-entry.js";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testOpenAIReasoning() {
  console.log("\n=== Testing OpenAI Reasoning ===");
  
  // Get API key from environment variables
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error("❌ No OpenAI API key found in .env file");
    return;
  }
  
  console.log("✓ Found OpenAI API key");
  
  // Create a Lang instance with a model that has good reasoning capabilities
  const lang = Lang.openai({
    apiKey,
    model: 'gpt-4o', // Using GPT-4o which has good reasoning capabilities
    systemPrompt: "Think through problems step by step, explaining your reasoning clearly."
  });
  
  console.log("✓ Initialized OpenAI provider with a reasoning-capable model");
  
  // A complex math problem that would benefit from reasoning
  const prompt = 'Solve this step by step: If a train travels at 120 km/h and another train travels at 80 km/h in the opposite direction, how long will it take for them to be 500 km apart if they start at the same location?';
  
  console.log("\nSending request to OpenAI...");
  console.log("Prompt:", prompt);
  console.log("\nStreaming Response:");
  
  // Variables to track streaming visualization
  let lastChunkLength = 0;
  let chunkCounter = 0;
  
  try {
    // Call the model with streaming to see the response as it's generated
    const result = await lang.ask(prompt, (result) => {
      // Visualize streaming chunks
      const currentAnswer = result.answer;
      const newContent = currentAnswer.slice(lastChunkLength);
      
      if (newContent) {
        chunkCounter++;
        // Every 5 chunks, print the chunk number and content
        if (chunkCounter % 5 === 0) {
          console.log(`\n[Chunk ${chunkCounter}]: ${newContent}`);
        } else {
          // For other chunks, just print a dot
          process.stdout.write(".");
        }
        
        lastChunkLength = currentAnswer.length;
      }
    });
    
    console.log("\n\nFinal answer:");
    console.log(result.answer);
    
    // Check if the answer contains step-by-step reasoning
    const hasStepByStep = result.answer.includes("step") || 
                          result.answer.toLowerCase().includes("first") ||
                          result.answer.toLowerCase().includes("second") ||
                          result.answer.toLowerCase().includes("calculate");
    
    if (hasStepByStep) {
      console.log("\n✓ Answer contains step-by-step reasoning");
    } else {
      console.log("\n⚠️ Answer may not contain detailed step-by-step reasoning");
    }
    
    console.log("\n✓ Test completed successfully!");
    return true; // Return true to indicate success
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    throw error; // Re-throw the error to fail the test
  }
}

// Run the test
testOpenAIReasoning().catch(console.error); 