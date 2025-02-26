// First import and configure dotenv
import * as dotenv from 'dotenv';
dotenv.config();

// Then dynamically import the module to handle top-level awaits
const { Lang } = await import('../../dist/npm-entry.js');

async function testDistBuild() {
  console.log("\n=== Testing Distribution Build ===");

  // Test provider initialization
  const openai = Lang.openai({ 
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
    model: 'gpt-4'
  });
  console.log("✓ OpenAI provider initialized");

  // Test model info access
  console.log("\nTesting model info access...");
  const models = Lang.models;
  
  // Use the getProviders() method to get available providers
  const providers = models.getProviders();
  console.log("✓ Available providers:", providers.join(", "));
  
  // Log count of available models
  console.log("✓ Number of available models:", models.length);

  // Only test API if key is available
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log("\nTesting OpenAI chat...");
      const result = await openai.ask("Say hi!", (res) => {
        process.stdout.write(".");
      });
      console.log("\n✓ OpenAI chat successful:", result.answer);
    } catch (error) {
      console.error("\n❌ OpenAI chat failed:", error.message);
    }
  } else {
    console.log("\n⚠️ Skipping API test - no OpenAI key provided");
  }
}

// Run tests
testDistBuild().catch(console.error); 