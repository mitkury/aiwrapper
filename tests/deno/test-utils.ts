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
      const { config } = await import("https://deno.land/x/dotenv@v3.2.2/mod.ts");
      try {
        await config({ export: true, path: ".env" });
        console.log("Environment variables loaded from .env file");
      } catch (error) {
        console.warn("Warning: Could not load .env file, using existing environment variables");
      }
      return Deno.env.get(name);
    } catch (error) {
      console.error("Error loading environment:", error);
      return undefined;
    }
  } else {
    // In Node, process.env should already be populated by dotenv
    return process.env[name];
  }
} 