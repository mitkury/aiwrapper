import { Lang } from "../../mod.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

// Load environment variables
await config({ export: true });

// Get OpenRouter API key from environment variables
const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") || "";

// Skip tests if API key is not available
const shouldSkipTests = !openRouterKey;
if (shouldSkipTests) {
  console.warn("⚠️ Skipping openaiLike tests: OPENROUTER_API_KEY not set");
}

Deno.test({
  name: "openaiLike - verify it works with OpenRouter API",
  ignore: shouldSkipTests,
  async fn() {
    // Setup both standard OpenRouter and openaiLike with OpenRouter
    const standardLang = Lang.openrouter({
      apiKey: openRouterKey,
      model: "openai/gpt-4o-mini"
    });

    const customLang = Lang.openaiLike({
      apiKey: openRouterKey,
      model: "openai/gpt-4o-mini",
      baseURL: "https://openrouter.ai/api/v1",
      // OpenRouter requires these headers
      headers: {
        "HTTP-Referer": "https://aiwrapper.dev",
        "X-Title": "AIWrapper Test"
      }
    });

    // Test with a simple question that should have consistent answers
    const prompt = "What is 2+2? Answer with just the number.";
    
    const standardResult = await standardLang.ask(prompt);
    const customResult = await customLang.ask(prompt);
    
    // Check that both responses contain the answer (4)
    assertEquals(
      standardResult.answer.trim().includes("4"), 
      true, 
      "Standard OpenRouter response should include '4'"
    );
    
    assertEquals(
      customResult.answer.trim().includes("4"), 
      true, 
      "openaiLike response should include '4'"
    );
  },
});

Deno.test({
  name: "openaiLike - custom parameters work",
  ignore: shouldSkipTests,
  async fn() {
    const customParamsLang = Lang.openaiLike({
      apiKey: openRouterKey,
      model: "openai/gpt-4o-mini",
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://aiwrapper.dev",
        "X-Title": "AIWrapper Test"
      },
      // Add custom parameters - set temperature high to ensure non-deterministic results
      bodyProperties: {
        temperature: 1.5,
        top_p: 0.9
      }
    });

    const prompt = "Give me a random single-digit number. Just respond with the digit.";
    const result = await customParamsLang.ask(prompt);
    
    // Check that the response is a single digit
    const digit = result.answer.trim().match(/\d/);
    assertEquals(
      digit !== null, 
      true, 
      "Response should include a digit with custom parameters"
    );
  },
}); 