// Examples of the new unified API

import { OpenAILang } from "../../src/lang/openai/openai-lang.ts";

// Initialize the model
const lang = new OpenAILang({
  apiKey: "your-api-key",
  model: "gpt-4o",
});

async function simpleTextGeneration() {
  const result = await lang.ask("Tell me about yourself");
  console.log(result.answer);
}

async function continuingConversation() {
  // Start a conversation
  const result = await lang.ask("Tell me about yourself");
  
  // Add a user message and continue
  result.addUserMessage("Tell me more");
  const newResult = await lang.chat(result.messages);
  
  // Add another and continue again
  newResult.addUserMessage("That's interesting");
  const finalResult = await lang.chat(newResult.messages);
  
  console.log(finalResult.messages); // Full conversation history
}

async function gettingStructuredData() {
  // Using the dedicated method for structured data
  const planets = await lang.askForObject(
    "List the planets in our solar system with their diameters",
    Array<{ name: string, diameter: number, unit: string }>
  );
  
  console.log(planets.object); // Structured array of planet objects
}

// Future implementation with tools
async function usingTools() {
  /*
  // Define tools
  const getWeatherTool = {
    name: "getWeather",
    description: "Get current weather for a location",
    parameters: {
      location: {
        type: "string",
        description: "The city and state or country",
      }
    }
  };
  
  // Ask with tools
  var weatherResult = await lang.ask(
    "What's the weather in New York and Los Angeles?", 
    { 
      tools: [getWeatherTool]
    }
  );
  
  console.log(weatherResult.tools); // Tool use request from the model
  
  // Example of executing the tools externally
  const toolUseResults = [
    {
      toolId: weatherResult.tools[0].id,
      result: { temperature: 72, condition: "sunny" }
    }
  ];
  
  // Add tool results back to the conversation
  weatherResult.addToolUseMessage(toolUseResults);
  
  // Continue the conversation with tool results
  weatherResult = await lang.chat(weatherResult.messages);
  
  console.log(weatherResult.answer); // Final response incorporating tool results
  */
}

// Example with streaming
async function streamingExample() {
  const result = await lang.ask(
    "Write a story about a robot learning to paint",
    {
      onResult: (partialResult) => {
        // This will be called repeatedly as new tokens are generated
        console.log("Received so far:", partialResult.answer.length, "chars");
      }
    }
  );
  
  console.log("Final result:", result.answer);
}

// Run examples
async function runExamples() {
  console.log("===== Simple Text Generation =====");
  await simpleTextGeneration();
  
  console.log("\n===== Continuing Conversation =====");
  await continuingConversation();
  
  console.log("\n===== Getting Structured Data =====");
  await gettingStructuredData();
  
  console.log("\n===== Streaming Example =====");
  await streamingExample();
}

runExamples().catch(console.error);