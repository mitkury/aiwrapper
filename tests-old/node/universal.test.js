// First, load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Import node-fetch for HTTP requests in Node
import fetch from 'node-fetch';
import { setHttpRequestImpl } from '../../dist/http-request.js';

// Configure the HTTP implementation for Node.js
// This is equivalent to what mod.ts does for Deno
setHttpRequestImpl((url, options) => {
  return fetch(url, options);
});

// Import the same test utilities
import { importLib, getEnvVar } from '../deno/test-utils.ts';

async function runTest() {
  try {
    // Get the library (either from source or dist based on environment)
    const { Lang } = await importLib();

    // Get OpenAI API key from environment
    const apiKey = await getEnvVar("OPENAI_API_KEY");
    if (!apiKey) {
      console.error("❌ OPENAI_API_KEY environment variable not set");
      process.exit(1);
    }

    // This helper function allows setting breakpoints and stepping through the code
    async function makeLangRequest(prompt) {
      console.log(`Making request with prompt: "${prompt}"`);
      const lang = Lang.openai({ apiKey: apiKey, model: "gpt-4o" });
      const result = await lang.ask(prompt);
      return result;
    }

    async function simpleTest() {
      console.log("Starting simple test...");
      const result = await makeLangRequest("What is the capital of the moon?");
      console.log(result);
    }

    await simpleTest();
    console.log("✅ Test completed successfully");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

runTest(); 