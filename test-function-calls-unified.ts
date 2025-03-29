// Unified test for function calling with AIWrapper for both OpenAI and Anthropic
import { load } from "https://deno.land/std@0.217.0/dotenv/mod.ts";
import { Lang } from "./mod.ts";
import { FunctionDefinition } from "./src/lang/language-provider.ts";

// Control debug output verbosity
const VERBOSE_DEBUG = false;

// Custom console.log wrapper to control verbosity
function debugLog(...args: any[]) {
  if (VERBOSE_DEBUG) {
    console.log(...args);
  }
}

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
  return (partialResult: any) => {
    // Only log function calls as they are detected
    if (partialResult.functionCalls && partialResult.functionCalls.length > 0) {
      const lastCall = partialResult.functionCalls[partialResult.functionCalls.length - 1];
      if (!lastCall.handled) {
        // Only log arguments if they're not empty
        const hasArgs = lastCall.arguments && Object.keys(lastCall.arguments).length > 0;
        console.log(`\n[${provider}] Function call detected: ${lastCall.name}${hasArgs ? " with args:" : ""}`);
        if (hasArgs) {
          console.log(JSON.stringify(lastCall.arguments, null, 2));
        }
        lastCall.handled = true;
      }
    }
  };
}

// Test function calling with a specific provider
async function testProvider(providerName: string, lang: any, prompt: string) {
  console.log(`\n\n--- Testing ${providerName} ---`);
  
  // Override console.log for provider-specific logs
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    // Filter out provider-specific debug logs
    const str = args.length > 0 ? String(args[0]) : '';
    
    if (
      VERBOSE_DEBUG || 
      (
        !str.includes('ANTHROPIC EVENT') && 
        !str.includes('Accumulated partial JSON') && 
        !str.includes('Adding tools to request') &&
        !str.includes('options:')
      )
    ) {
      originalConsoleLog(...args);
    }
  };
  
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
    
    // Restore console.log
    console.log = originalConsoleLog;
    
    if (result.functionCalls && result.functionCalls.length > 0) {
      console.log(`\n${providerName} function calls summary:`);
      for (const call of result.functionCalls) {
        console.log(`- ${call.name}(${JSON.stringify(call.arguments, null, 2)})`);
      }
      return true;
    } else {
      console.log(`\n${providerName}: No function calls detected`);
      return false;
    }
  } catch (error) {
    // Restore console.log
    console.log = originalConsoleLog;
    console.error(`Error testing ${providerName}:`, error);
    return false;
  }
}

async function runTests() {
  console.log("=== Function Calling Comparison ===");
  
  // The prompt to test
  const prompt = "What's the weather like in San Francisco, CA right now? I need the current temperature in Celsius.";
  console.log(`\nTesting with prompt: "${prompt}"`);
  console.log(`\nExpected function: getCurrentWeather({ location: "San Francisco, CA", unit: "celsius" })`);
  
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
      console.error("Error initializing Google Gemini:", error);
    }
  } else {
    console.log("\nSkipping Google Gemini - API key not found");
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
    console.log("\nSkipping OpenAI - API key not found");
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
    console.log("\nSkipping Anthropic - API key not found");
  }
  
  // Summary
  console.log("\n\n=== Results Comparison ===");
  console.log("Provider       | Status | Function Call Structure");
  console.log("---------------|--------|------------------------");
  console.log(`Google Gemini  | ${googleSuccess ? "✓" : "✗"}      | { location: 'San Francisco, CA', unit: 'celsius' }`);
  console.log(`OpenAI         | ${openaiSuccess ? "✓" : "✗"}      | { location: 'San Francisco, CA', unit: 'celsius' }`);
  console.log(`Anthropic      | ${anthropicSuccess ? "✓" : "✗"}      | { location: 'San Francisco, CA', unit: 'celsius' }`);
}

// Run all tests
runTests(); 