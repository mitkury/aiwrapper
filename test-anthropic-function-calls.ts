// Test for function calling with AIWrapper using Deno for Anthropic
import { load } from "https://deno.land/std@0.217.0/dotenv/mod.ts";
import { Lang } from "./mod.ts";
import { FunctionDefinition } from "./src/lang/language-provider.ts";

// Load environment variables from .env file
await load({ export: true });

// Define our function for the model to call - properly formatted according to language-provider.ts
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

// Add debug listener for fetch requests
let lastRequest: any = null;
const originalFetch = globalThis.fetch;
// @ts-ignore
globalThis.fetch = function monitorFetch(input, init) {
  // Only monitor Anthropic API calls
  if (input.toString().includes('anthropic.com')) {
    console.log(`\nRequest URL: ${input}`);
    if (init?.body) {
      // Store the request body for debugging
      lastRequest = JSON.parse(init.body.toString());
      console.log('Request body:', JSON.stringify(lastRequest, null, 2));
    }
  }
  return originalFetch(input, init);
};

// For the direct API call, convert our functions to Anthropic format
function convertToAnthropicFormat(functions: FunctionDefinition[]) {
  return functions.map(f => ({
    name: f.name,
    description: f.description,
    input_schema: {
      type: "object",
      properties: Object.entries(f.parameters).reduce((acc, [name, param]) => {
        acc[name] = {
          type: param.type,
          description: param.description,
        };
        if (param.enum) {
          acc[name].enum = param.enum;
        }
        return acc;
      }, {} as Record<string, any>),
      required: Object.entries(f.parameters)
        .filter(([_, param]) => param.required)
        .map(([name, _]) => name)
    }
  }));
}

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

async function runTest() {
  try {
    console.log("Testing function calling with AIWrapper for Anthropic...");
    
    // Get API key from loaded environment variables
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    
    if (!apiKey) {
      console.error("Please set your Anthropic API key in the .env file");
      Deno.exit(1);
    }
    
    // First, try a direct call to the Anthropic API with converted functions
    console.log("\n--- Direct API Call ---");
    const prompt = "What's the weather like in San Francisco, CA right now? I need the current temperature.";
    
    // Convert our FunctionDefinition[] to Anthropic format
    const tools = convertToAnthropicFormat(functions);
    
    try {
      const directResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "tools-2024-04-04" // Required for tools beta
        },
        body: JSON.stringify({
          model: "claude-3-7-sonnet-20250219",
          messages: [{ role: "user", content: prompt }],
          tools: tools,
          max_tokens: 1024,
        }),
      });
      
      if (!directResponse.ok) {
        const errorText = await directResponse.text();
        console.error(`Direct API call failed: ${directResponse.status}`, errorText);
      } else {
        const data = await directResponse.json();
        console.log("\nDirect Anthropic API Response:", JSON.stringify(data, null, 2));
        
        // Extract and log the raw content array structure for detailed analysis
        if (data.content && Array.isArray(data.content)) {
          console.log("\nExamining content array structure:");
          data.content.forEach((item: any, index: number) => {
            console.log(`[${index}] type: ${item.type}`);
            if (item.type === 'tool_use') {
              console.log(`  - name: ${item.name}`);
              console.log(`  - id: ${item.id}`);
              console.log(`  - input: ${JSON.stringify(item.input)}`);
            } else if (item.type === 'text') {
              console.log(`  - text: ${item.text.substring(0, 50)}${item.text.length > 50 ? '...' : ''}`);
            }
          });
        }
        
        // Check if the direct API call resulted in a function call
        const toolUseBlocks = data.content?.filter((block: any) => block.type === "tool_use");
        if (toolUseBlocks && toolUseBlocks.length > 0) {
          console.log("\nDirect API call resulted in a function call - structure works!");
          const calls = toolUseBlocks.map((block: any) => ({
            id: block.id,
            name: block.name,
            arguments: block.input
          }));
          calls.forEach((call: any) => {
            console.log(`- Function: ${call.name}`);
            console.log(`  Arguments:`, call.arguments);
          });
        } else {
          console.log("\nDirect API call didn't result in a function call.");
        }
      }
    } catch (err) {
      console.error("Error with direct API call:", err);
    }
    
    // Now try with AIWrapper
    console.log("\n--- Now trying with AIWrapper ---");
    const lang = Lang.anthropic({
      apiKey: apiKey,
      model: "claude-3-7-sonnet-20250219",
      systemPrompt: "You are a helpful assistant that can provide weather information."
    });
    
    console.log(`\nPrompt: ${prompt}`);
    console.log("\nSending request to Anthropic API via AIWrapper...");
    
    // Log the functions we're passing to verify they're correct
    console.log("\nFunctions being passed:", JSON.stringify(functions, null, 2));

    // Create a callback function separately from the options
    let partialContent = ""; // Track partial content for debugging
    const onResultCallback = (partialResult: any) => {
      // Log function calls as they happen
      if (partialResult.functionCalls && partialResult.functionCalls.length > 0) {
        const lastCall = partialResult.functionCalls[partialResult.functionCalls.length - 1];
        if (lastCall.name) {
          console.log(`\nFunction call detected: ${lastCall.name}`);
          if (Object.keys(lastCall.arguments).length > 0) {
            console.log(`Arguments: ${JSON.stringify(lastCall.arguments)}`);
          }
        }
      }
      
      // Show progress for text responses
      if (partialResult.answer && partialResult.answer !== partialContent) {
        const newContent = partialResult.answer.slice(partialContent.length);
        console.log(newContent);
        partialContent = partialResult.answer;
      }
    };
    
    // Create options object separately and log it for debugging
    const askOptions = {
      onResult: onResultCallback,
      functions,
      functionHandler: handleFunctionCall,
      functionCall: "auto" as const // Specify exact type to match LangOptions
    };
    
    console.log("\nOptions object:", JSON.stringify({
      hasFunctions: !!askOptions.functions,
      functionCount: askOptions.functions?.length,
      hasFunctionHandler: !!askOptions.functionHandler,
      functionCall: askOptions.functionCall,
    }, null, 2));
    
    // AnthropicLang now accepts the same parameter style as OpenAILikeLang
    const result = await lang.ask(prompt, askOptions);
    
    console.log(`\n\nFinal answer from AIWrapper: "${result.answer}"`);
    
    if (result.functionCalls && result.functionCalls.length > 0) {
      console.log(`\nFunction calls made: ${result.functionCalls.length}`);
      for (const call of result.functionCalls) {
        console.log(`- ${call.name}(${JSON.stringify(call.arguments)})`);
      }
    } else {
      console.log("\nNo function calls were made through AIWrapper.");
      
      // Debug information to help troubleshoot
      console.log("\nComparing requests:");
      console.log("1. Is the 'tools' field in the AIWrapper request? ", lastRequest?.tools ? "Yes" : "No");
      console.log("2. Model used in AIWrapper: ", lastRequest?.model);
    }
    
    console.log("\nTest completed!");
  } catch (error) {
    console.error("Error in test:", error);
    
    // Print error details
    if (error instanceof Error) {
      console.error("\nError details:", error.message);
      if (error.stack) {
        const stack = error.stack.split("\n");
        console.error("Stack trace (first 3 lines):", stack.slice(0, 3).join("\n"));
      }
    }
  }
}

// Run the test
runTest(); 