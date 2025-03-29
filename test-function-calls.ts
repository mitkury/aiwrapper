// Test for function calling with AIWrapper using Deno
import { load } from "https://deno.land/std@0.217.0/dotenv/mod.ts";
import { Lang } from "./mod.ts";
import { FunctionDefinition, FunctionParameter } from "./src/lang/language-provider.ts";

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
  // Only monitor OpenAI API calls
  if (input.toString().includes('openai.com')) {
    console.log(`\nRequest URL: ${input}`);
    if (init?.body) {
      // Store the request body for debugging
      lastRequest = JSON.parse(init.body.toString());
      console.log('Request body:', JSON.stringify(lastRequest, null, 2));
    }
  }
  return originalFetch(input, init);
};

// For the direct API call, convert our functions to OpenAI format
function convertToOpenAIFormat(functions: FunctionDefinition[]) {
  return functions.map(f => ({
    type: "function",
    function: {
      name: f.name,
      description: f.description,
      parameters: {
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
    console.log("Testing function calling with AIWrapper...");
    
    // Get API key from loaded environment variables
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    
    if (!apiKey) {
      console.error("Please set your OpenAI API key in the .env file");
      Deno.exit(1);
    }
    
    // First, try a direct call to the OpenAI API with converted functions
    console.log("\n--- Direct API Call ---");
    const prompt = "What's the weather like in San Francisco, CA right now? I need the current temperature.";
    
    // Convert our FunctionDefinition[] to OpenAI format
    const tools = convertToOpenAIFormat(functions);
    
    try {
      const directResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4-turbo",
          messages: [{ role: "user", content: prompt }],
          tools: tools,
          tool_choice: "auto", // Let the model decide whether to call a function
        }),
      });
      
      if (!directResponse.ok) {
        const errorText = await directResponse.text();
        console.error(`Direct API call failed: ${directResponse.status}`, errorText);
      } else {
        const data = await directResponse.json();
        console.log("\nDirect OpenAI API Response:", JSON.stringify(data.choices[0].message, null, 2));
        
        // Check if the direct API call resulted in a function call
        if (data.choices[0].message?.tool_calls) {
          console.log("\nDirect API call resulted in a function call - structure works!");
        } else {
          console.log("\nDirect API call didn't result in a function call.");
        }
      }
    } catch (err) {
      console.error("Error with direct API call:", err);
    }
    
    // Now try with AIWrapper
    console.log("\n--- Now trying with AIWrapper ---");
    const lang = Lang.openaiLike({
      apiKey: apiKey,
      model: "gpt-4-0125-preview", // Use a model we know supports function calling well
      baseURL: "https://api.openai.com/v1",
      systemPrompt: "You are a helpful assistant that can provide weather information."
    });
    
    console.log(`\nPrompt: ${prompt}`);
    console.log("\nSending request to OpenAI API via AIWrapper...");
    
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
    
    const result = await lang.ask(prompt, onResultCallback, {
      functions: functions,
      functionHandler: handleFunctionCall,
      functionCall: "auto" // Use "auto" to let the model choose to call a function
    });
    
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
      console.log("2. Is 'tool_choice' set in AIWrapper request? ", lastRequest?.tool_choice ? `Yes, to ${JSON.stringify(lastRequest.tool_choice)}` : "No");
      console.log("3. Model used in AIWrapper: ", lastRequest?.model);
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