// Test script for Anthropic's extended thinking feature
// This tests the implementation of extended thinking for Claude 3.7 models

import { Lang } from "../../dist/npm-entry.js";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAnthropicExtendedThinking() {
  console.log("\n=== Testing Anthropic Extended Thinking ===");

  // Get API key from environment variables
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("❌ No Anthropic API key found in .env file");
    return;
  }

  console.log("✓ Found Anthropic API key");

  // Create a Lang instance with extended thinking enabled
  const lang = Lang.anthropic({
    apiKey,
    model: 'claude-3-7-sonnet-20250219',
    extendedThinking: true
  });

  console.log("✓ Initialized Anthropic provider with extended thinking enabled");

  // A complex math problem that would benefit from extended thinking
  const prompt = 'Solve this step by step: If a train travels at 120 km/h and another train travels at 80 km/h in the opposite direction, how long will it take for them to be 500 km apart if they start at the same location?';

  console.log("\nSending request to Claude 3.7 with extended thinking...");
  console.log("Prompt:", prompt);
  console.log("\nResponse:");

  try {
    // Call the model with streaming to see the response as it's generated
    const result = await lang.ask(prompt, (result) => {

    });

    console.log("\n\nFinal answer:");
    console.log(result.answer);

    console.log("\nThinking content:");
    console.log(result.thinking);

    console.log("\n✓ Test completed successfully!");
    return true; // Return true to indicate success
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    throw error; // Re-throw the error to fail the test
  }
}

// Run the test
testAnthropicExtendedThinking().catch(console.error); 