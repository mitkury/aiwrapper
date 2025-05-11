import { LangChatMessage } from "../../src/lang/language-provider.ts";
import { importLib, getEnvVar } from "./test-utils.ts";

// Get the library (either from source or dist based on environment)
const { Lang } = await importLib();

// Get OpenAI API key from environment
const apiKey = await getEnvVar("OPENAI_API_KEY");
if (!apiKey) {
  console.error("❌ OPENAI_API_KEY environment variable not set");
  if (typeof Deno !== 'undefined') {
    Deno.exit(1);
  } else {
    process.exit(1);
  }
}

const lang = Lang.openai({ apiKey: apiKey as string, model: "gpt-4o" });
const prompt = "What is the capital of Sri Lanka?";

async function ask() {
  console.log("lang.ask");
  console.log(`Asking: "${prompt}"`);

  try {
    const result = await lang.ask(prompt);
    
    if (result.finished && result.answer.length > 0) {
      console.log(result.answer);
      console.log("✅ Test passed");
    } else {
      console.log(result);
      console.error("❌ Test failed");
    }
  } catch (error) {
    console.error(error);
  }
}

async function chat() {
  console.log("lang.chat");
 
  const messages = [
    { role: "user", content: "hey" },
    { role: "assistant", content: "what's up?" },
    { role: "user", content: prompt }
  ] as LangChatMessage[];

  try {
    const result = await lang.chat(messages);
    
    if (result.finished && result.answer.length > 0) {
      console.log(result.answer);
      console.log("✅ Test passed");
    } else {
      console.log(result);
      console.error("❌ Test failed");
    }
  } catch (error) {
    console.error(error);
  }
}

async function structuredOutput() {
  console.log("lang.askForObject");

  const schema = {
    type: "object",
    properties: {
      country: { type: "string" },
      capital: { type: "string" }
    }
  }

  let result = await lang.askForObject(prompt, schema);

  if (result.finished && result.object) {
    console.log(result.object);
    console.log("✅ Test passed");
  } else {
    console.log(result);
    console.error("❌ Test failed");
  }

  console.log("lang.chat with schema");

  const messages = [
    { role: "user", content: prompt }
  ] as LangChatMessage[];

  result = await lang.chat(messages, { schema });

  if (result.finished && result.object) {
    console.log(result.object);
    console.log("✅ Test passed");
  } else {
    console.log(result);
    console.error("❌ Test failed");
  }
}

async function tools() {
  console.log("lang.chat with tools");
  // @TODO: Implement tools
}

console.log("simple.test.ts");

console.log("Running the the same prompt for ask, chat, structured output and tools")

//await ask(); 
//await chat();
await structuredOutput();

