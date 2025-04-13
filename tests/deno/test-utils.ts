/**
 * Dynamically imports the library from either source (for Deno) or dist (for Node)
 * This allows using the same test code for both environments.
 */
export async function importLib() {
  try {
    if (typeof Deno !== 'undefined') {
      // We're in Deno, import from the Deno entry point (mod.ts)
      // which sets up the HTTP implementation 
      console.log("🦕 Running in Deno - importing from mod.ts");
      return await import("../../mod.ts");
    } else {
      // We're in Node, import from dist
      console.log("📦 Running in Node - importing from dist");
      return await import("../../dist/index.js");
    }
  } catch (error) {
    console.error("Failed to import library:", error);
    throw error;
  }
}

/**
 * Helper function to get environment variables in a cross-runtime way
 */
export async function getEnvVar(name: string): Promise<string | undefined> {
  if (typeof Deno !== 'undefined') {
    // Load .env file in Deno
    try {
      // Log current working directory for debugging path issues
      console.log(`🦕 Current working directory: ${Deno.cwd()}`);
      const { config } = await import("https://deno.land/x/dotenv@v3.2.2/mod.ts");
      const envPath = ".env"; // Explicitly define the path we expect
      console.log(`🦕 Attempting to load environment variables from: ${envPath}`);
      try {
        await config({ export: true, path: envPath });
        console.log(`✅ Successfully loaded environment variables from ${envPath}`);
      } catch (error) {
        console.warn(`⚠️ Warning: Could not load ${envPath} file. Error: ${error.message}. Using existing environment variables.`);
      }
      const value = Deno.env.get(name);
      console.log(`🦕 Value for ${name}: ${value ? 'found' : 'not found'}`);
      return value;
    } catch (error) {
      console.error("❌ Error during environment setup:", error);
      return undefined;
    }
  } else {
    // In Node, process.env should already be populated by dotenv
    return process.env[name];
  }
} 
