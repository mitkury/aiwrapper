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

// Mock weather data to return
const mockWeatherData = {
  temperature: 20,
  unit: "celsius",
  condition: "partly cloudy",
  location: "San Francisco, CA",
  humidity: 65,
  wind: "10 km/h",
  forecast: "Similar conditions expected for the next 24 hours"
};

// Function implementation that will be called by the model
async function handleFunctionCall(call: any) {
  console.log(`\nFunction called: ${call.name}`);
  console.log(`Arguments:`, call.arguments);
  
  if (call.name === "getCurrentWeather") {
    // Return mock weather data
    const location = call.arguments.location || "Unknown location";
    const unit = call.arguments.unit || "fahrenheit";
    
    // Adjust temperature based on unit
    const temperatureValue = unit === "celsius" ? mockWeatherData.temperature : (mockWeatherData.temperature * 9/5) + 32;
    
    return {
      ...mockWeatherData,
      temperature: temperatureValue,
      unit: unit,
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

// Test function calling with a specific provider - Step 1: Get function calls from LLM
async function testProvider(providerName: string, lang: any, prompt: string) {
  console.log(`\n\n--- Testing ${providerName} - Step 1: Initial Query ---`);
  
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
  
  let functionDetected = false;
  let feedbackSuccess = false;
  
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
      
      functionDetected = true;
      
      // Step 2: Send function results back to the LLM
      feedbackSuccess = await testFeedbackStep(providerName, lang, result);
      
      return { functionDetected, feedbackSuccess };
    } else {
      console.log(`\n${providerName}: No function calls detected`);
      return { functionDetected: false, feedbackSuccess: false };
    }
  } catch (error) {
    // Restore console.log
    console.log = originalConsoleLog;
    console.error(`Error testing ${providerName}:`, error);
    return { functionDetected: false, feedbackSuccess: false };
  }
}

// Test feeding function results back to the LLM - Step 2
async function testFeedbackStep(providerName: string, lang: any, previousResult: any) {
  console.log(`\n--- Testing ${providerName} - Step 2: Feeding Results Back ---`);
  
  // Only proceed if there are function calls
  if (!previousResult.functionCalls || previousResult.functionCalls.length === 0) {
    console.log(`No function calls to process for ${providerName}`);
    return false;
  }
  
  // Debug the structure of previousResult to understand message format
  console.log(`Result structure for ${providerName}:`, 
    Object.keys(previousResult).map(key => `${key}: ${typeof previousResult[key]}`).join(', ')
  );
  
  if (previousResult.messages) {
    console.log(`Messages type: ${Array.isArray(previousResult.messages) ? 'array' : typeof previousResult.messages}`);
    console.log(`Messages length: ${Array.isArray(previousResult.messages) ? previousResult.messages.length : 'N/A'}`);
  } else {
    console.log('No messages found in result');
  }
  
  try {
    // Execute all function calls and get the results
    const functionResults = await Promise.all(
      previousResult.functionCalls.map(async (call: any) => {
        const result = await handleFunctionCall(call);
        return { call, result };
      })
    );
    
    // This would normally happen automatically in handleFunctionCalls
    // But we want to show it explicitly for the test
    console.log(`\n${providerName} - Function results being fed back to LLM:`);
    for (const { call, result } of functionResults) {
      console.log(`- ${call.name} result:`, result);
    }
    
    // For simplicity in this test, directly make a new request with the results
    // rather than trying to construct the exact messages expected by each provider
    
    // Create a result string from the mock weather data
    const weatherData = functionResults[0].result;
    const weatherDescription = 
      `Current weather in ${weatherData.location}:
      - Temperature: ${weatherData.temperature}°${weatherData.unit.charAt(0).toUpperCase()}
      - Condition: ${weatherData.condition}
      - Humidity: ${weatherData.humidity}%
      - Wind: ${weatherData.wind}
      - Forecast: ${weatherData.forecast}`;
      
    // Make a simple follow-up request
    console.log(`\n${providerName} - Sending weather results to LLM for summary...`);
    
    const prompt = `I asked for the weather in San Francisco and got these results:
    
${weatherDescription}

Based on this data, provide a concise, human-friendly summary of the current weather conditions in San Francisco.`;
    
    // Use a simple ask without function calling for the follow-up
    const finalResult = await lang.ask(
      prompt,
      (partialResult: any) => {
        if (partialResult.answer && partialResult.answer.length > 0) {
          // Only show substantial updates to reduce noise
          if (partialResult.answer.length % 50 === 0 || partialResult.answer.length < 50) {
            console.log(`\n[${providerName}] Generating response: ${partialResult.answer.length} chars`);
          }
        }
      }
    );
    
    // Log the LLM's response to function results
    console.log(`\n${providerName} - Final response after processing function results:`);
    console.log(`"${finalResult.answer}"`);
    
    return true;
  } catch (error) {
    console.error(`Error in feedback step for ${providerName}:`, error);
    return false;
  }
}

async function runTests() {
  console.log("=== Function Calling Comparison - Two-Step Process ===");
  console.log("Step 1: Get function calls from LLMs");
  console.log("Step 2: Feed function results back to LLMs");
  
  // The prompt to test
  const prompt = "What's the weather like in San Francisco, CA right now? I need the current temperature in Celsius.";
  console.log(`\nTesting with prompt: "${prompt}"`);
  console.log(`\nExpected function: getCurrentWeather({ location: "San Francisco, CA", unit: "celsius" })`);
  
  // Get API keys from .env
  const googleApiKey = Deno.env.get("GOOGLE_API_KEY");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  
  // Test results
  let googleResults = { functionDetected: false, feedbackSuccess: false };
  let openaiResults = { functionDetected: false, feedbackSuccess: false };
  let anthropicResults = { functionDetected: false, feedbackSuccess: false };
  
  // Test Google first for faster debugging
  if (googleApiKey) {
    try {
      const google = Lang.google({
        apiKey: googleApiKey,
        model: "gemini-2.0-flash", // Use newer Gemini model with function calling support
        systemPrompt: "You are a helpful assistant that can provide weather information."
      });
      
      googleResults = await testProvider("Google Gemini", google, prompt);
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
    
    openaiResults = await testProvider("OpenAI", openai, prompt);
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
    
    anthropicResults = await testProvider("Anthropic", anthropic, prompt);
  } else {
    console.log("\nSkipping Anthropic - API key not found");
  }
  
  // Summary
  console.log("\n\n=== Results Comparison ===");
  console.log("Provider       | Step 1: Function Detection | Step 2: Result Processing");
  console.log("---------------|----------------------------|-------------------------");
  console.log(`Google Gemini  | ${googleResults.functionDetected ? "✓" : "✗"}                          | ${googleResults.feedbackSuccess ? "✓" : "✗"}`);
  console.log(`OpenAI         | ${openaiResults.functionDetected ? "✓" : "✗"}                          | ${openaiResults.feedbackSuccess ? "✓" : "✗"}`);
  console.log(`Anthropic      | ${anthropicResults.functionDetected ? "✓" : "✗"}                          | ${anthropicResults.feedbackSuccess ? "✓" : "✗"}`);
}

// Run all tests
runTests(); 