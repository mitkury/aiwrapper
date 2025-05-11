import {
  Lang,
  LanguageProvider,
  Tool,
  ToolRequest,
  ToolResult
} from "../../mod.ts";
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

// Load environment variables
await config({ export: true });

// Configuration - using environment variables
const CONFIG = {
  openai: {
    enabled: !!Deno.env.get("OPENAI_API_KEY"),
    options: {
      apiKey: Deno.env.get("OPENAI_API_KEY") || "",
      model: "gpt-4o",
    },
  },
};

function getEnabledLangProviders(): Record<string, LanguageProvider> {
  const providers: Record<string, LanguageProvider> = {};

  if (CONFIG.openai.enabled) {
    providers.openai = Lang.openai(CONFIG.openai.options);
  }

  return providers;
}

// Define a simple weather tool
const getWeatherTool: Tool = {
  name: "getWeather",
  description: "Get the current weather for a location",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "The city and state, e.g. San Francisco, CA",
      },
    },
    required: ["location"],
  },
};

// Mock function to simulate tool execution
function useTools(toolRequests: ToolRequest[] | null): ToolResult[] {
  if (!toolRequests) return [];
  
  return toolRequests.map(request => {
    if (request.name === "getWeather") {
      const location = request.arguments.location;
      return {
        toolId: request.id,
        result: {
          temperature: 72,
          condition: "Sunny",
          location: location,
        }
      };
    }
    return {
      toolId: request.id,
      result: "Unknown tool"
    };
  });
}

// Test the basic API functionality
async function testBasicAPI() {
  console.log("\n=== Testing New API Functionality ===");
  const providers = getEnabledLangProviders();

  if (Object.keys(providers).length === 0) {
    console.log("❌ No models enabled for testing - please check your .env file");
    return;
  }

  for (const [name, lang] of Object.entries(providers)) {
    try {
      console.log(`Testing ${name} simple ask...`);
      const result = await lang.ask("Say hi!");
      console.log(`✓ ${name} response: ${result.answer}\n`);
      
      // Test conversation management
      console.log(`Testing ${name} conversation...`);
      result.addUserMessage("Tell me more about yourself");
      const newResult = await lang.chat(result.messages);
      console.log(`✓ ${name} follow-up response: ${newResult.answer}\n`);
      
      // Test object extraction
      console.log(`Testing ${name} object extraction...`);
      const schema = {
        type: "object",
        properties: {
          greeting: { type: "string" },
          mood: { type: "string" }
        }
      };
      
      const objectResult = await lang.askForObject(
        "Respond with a greeting and your current mood",
        schema
      );
      
      console.log(`✓ ${name} object: ${JSON.stringify(objectResult.object)}\n`);
      
      // Test tool usage
      console.log(`Testing ${name} tool usage...`);
      const weatherResult = await lang.ask(
        "What's the weather in New York?",
        { tools: [getWeatherTool] }
      );
      
      if (weatherResult.tools && weatherResult.tools.length > 0) {
        console.log(`✓ ${name} requested tool: ${weatherResult.tools[0].name}`);
        
        // Execute the tools
        const toolResults = useTools(weatherResult.tools);
        weatherResult.addToolUseMessage(toolResults);
        
        // Continue the conversation with tool results
        const finalResult = await lang.chat(weatherResult.messages);
        console.log(`✓ ${name} tool response: ${finalResult.answer}\n`);
      } else {
        console.log(`❌ ${name} did not request any tools\n`);
      }
      
    } catch (error: unknown) {
      console.error(`❌ ${name} Error:`, error instanceof Error ? error.message : String(error));
    }
  }
}

// Run the tests
await testBasicAPI();
