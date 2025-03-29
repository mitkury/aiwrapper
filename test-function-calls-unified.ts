// Unified test for function calling with AIWrapper for both OpenAI and Anthropic
import { load } from "https://deno.land/std@0.217.0/dotenv/mod.ts";
import { Lang } from "./mod.ts";
import { FunctionDefinition } from "./src/lang/language-provider.ts";

// Load environment variables from .env file
await load({ export: true });

// Define our function for the model to call - using the same format for both providers
const functions: FunctionDefinition[] = [
  {
    name: "getCurrentWeather",
    description: "Get the current weather in a given location",
    parameters: {
      location: {
        name: "location",
        type: "string",
        description: "The city and state, e.g., San Francisco, CA",
        required: true
      },
      unit: {
        name: "unit", 
        type: "string",
        enum: ["celsius", "fahrenheit"],
        description: "The unit of temperature",
        required: false
      }
    }
  }
];

// Function implementation that will be called by the model
async function handleFunctionCall(call: any) {
  console.log(`\nFunction called: ${call.name}`);
  console.log(`Arguments:`, call.arguments);
  
  if (call.name === "getCurrentWeather") {
    // Return mock weather data
    const location = call.arguments.location || "Unknown location";
    const unit = call.arguments.unit || "fahrenheit";
    
    return {
      temperature: 72,
      unit: unit,
      condition: "sunny",
      location: location
    };
  }
  
  return { error: "Function not implemented" };
}

// Tracking callback for monitoring progress
function createProgressCallback(provider: string) {
  let partialContent = ""; // Track partial content for debugging
  return (partialResult: any) => {
    // Log function calls as they happen
    if (partialResult.functionCalls && partialResult.functionCalls.length > 0) {
      const lastCall = partialResult.functionCalls[partialResult.functionCalls.length - 1];
      if (!lastCall.handled) {
        console.log(`\n[${provider}] Function call detected: ${lastCall.name}`);
        console.log(`Arguments: ${JSON.stringify(lastCall.arguments)}`);
        lastCall.handled = true;
      }
    }
    
    // Show progress for text responses
    if (partialResult.answer && partialResult.answer !== partialContent) {
      process.stdout.write('.');
      partialContent = partialResult.answer;
    }
  };
}

// Test function calling with a specific provider
async function testProvider(providerName: string, lang: any, prompt: string) {
  console.log(`\n\n--- Testing ${providerName} Function Calling ---`);
  console.log(`Prompt: "${prompt}"`);
  
  try {
    const result = await lang.ask(
      prompt, 
      createProgressCallback(providerName),
      {
        functions: functions,
        functionHandler: handleFunctionCall,
        functionCall: "auto" // Let the model decide when to call the function
      }
    );
    
    console.log(`\n\n${providerName} final answer: "${result.answer}"`);
    
    if (result.functionCalls && result.functionCalls.length > 0) {
      console.log(`\nFunction calls made: ${result.functionCalls.length}`);
      for (const call of result.functionCalls) {
        console.log(`- ${call.name}(${JSON.stringify(call.arguments)})`);
      }
      return true;
    } else {
      console.log(`\nNo function calls were made through ${providerName}.`);
      return false;
    }
  } catch (error) {
    console.error(`Error testing ${providerName}:`, error);
    return false;
  }
}

async function runTests() {
  console.log("=== Unified Function Calling Test ===");
  
  // The same prompt for both providers
  const prompt = "What's the weather like in San Francisco, CA right now? I need the current temperature.";
  
  // Get API keys from .env
  const googleApiKey = Deno.env.get("GOOGLE_API_KEY");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  
  // Test results
  let googleSuccess = false;
  let openaiSuccess = false;
  let anthropicSuccess = false;
  
  // Test Google first for faster debugging
  if (googleApiKey) {
    try {
      const google = Lang.google({
        apiKey: googleApiKey,
        model: "gemini-2.0-flash", // Use newer Gemini model with function calling support
        systemPrompt: "You are a helpful assistant that can provide weather information."
      });
      
      googleSuccess = await testProvider("Google Gemini", google, prompt);
    } catch (error) {
      console.error("Error testing Google Gemini:", error);
    }
  } else {
    console.log("\nSkipping Google Gemini test - API key not found in .env file");
  }
  
  // Test OpenAI
  if (openaiApiKey) {
    const openai = Lang.openaiLike({
      apiKey: openaiApiKey,
      model: "gpt-4-0125-preview",
      baseURL: "https://api.openai.com/v1",
      systemPrompt: "You are a helpful assistant that can provide weather information."
    });
    
    openaiSuccess = await testProvider("OpenAI", openai, prompt);
  } else {
    console.log("\nSkipping OpenAI test - API key not found in .env file");
  }
  
  // Test Anthropic
  if (anthropicApiKey) {
    const anthropic = Lang.anthropic({
      apiKey: anthropicApiKey,
      model: "claude-3-7-sonnet-20250219",
      systemPrompt: "You are a helpful assistant that can provide weather information."
    });
    
    anthropicSuccess = await testProvider("Anthropic", anthropic, prompt);
  } else {
    console.log("\nSkipping Anthropic test - API key not found in .env file");
  }
  
  // Summary
  console.log("\n\n=== Test Summary ===");
  console.log(`Google Gemini function calling: ${googleSuccess ? "✓ SUCCESS" : "✗ FAILED"}`);
  console.log(`OpenAI function calling: ${openaiSuccess ? "✓ SUCCESS" : "✗ FAILED"}`);
  console.log(`Anthropic function calling: ${anthropicSuccess ? "✓ SUCCESS" : "✗ FAILED"}`);
  console.log("\nTest completed!");
}

// Run all tests
runTests(); 