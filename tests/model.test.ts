import { describe, it, expect } from "vitest";
import { models, Model } from "aimodels";
import { Lang } from "aiwrapper";

function parseModelArg(): { modelId: string; provider?: string } | null {
  // Use environment variable (CLI flags don't work with vitest via npm scripts)
  // Usage: MODEL=gpt-4 npm run test:model
  //        MODEL="gpt-4@openai" npm run test:model
  const modelArg = process.env.MODEL;
  
  if (!modelArg) {
    return null;
  }
  
  // Parse model-id@provider format
  const parts = modelArg.split('@');
  if (parts.length === 2) {
    return { modelId: parts[0], provider: parts[1] };
  }
  
  return { modelId: modelArg };
}

function findModel(modelId: string, provider?: string): { model: Model | null; providerId: string | null } {
  // Find the model by ID globally
  const model = models.id(modelId);
  if (!model) {
    return { model: null, providerId: null };
  }
  
  // Get provider from model's source.creatorId
  const creatorId = (model as any).source?.creatorId;
  
  // If provider was specified, verify it matches
  if (provider && creatorId && creatorId.toLowerCase() !== provider.toLowerCase()) {
    console.warn(`⚠️  Warning: Model "${modelId}" belongs to provider "${creatorId}", not "${provider}"`);
  }
  
  return { model, providerId: creatorId || null };
}

const modelArg = parseModelArg();

if (!modelArg) {
  console.error('\n❌ No model specified!');
  console.error('Usage: MODEL=<model-id> npm run test:model');
  console.error('       MODEL="<model-id>@<provider>" npm run test:model');
  console.error('Examples:');
  console.error('  MODEL=gpt-4 npm run test:model');
  console.error('  MODEL="gpt-4@openai" npm run test:model');
  console.error('  MODEL=claude-3-7-sonnet-20250219 npm run test:model\n');
}

const modelResult = modelArg ? findModel(modelArg.modelId, modelArg.provider) : { model: null, providerId: null };
const modelInfo = modelResult.model;
const providerId = modelResult.providerId;

if (modelArg && !modelInfo) {
  console.error(`\n❌ Model "${modelArg.modelId}"${modelArg.provider ? ` (provider: ${modelArg.provider})` : ''} not found in aimodels database.\n`);
}

if (modelInfo) {
  console.log('\n✅ Model found:');
  console.log(`   ID: ${modelInfo.id}`);
  console.log(`   Provider: ${providerId || 'unknown'}`);
  console.log(`   Capabilities: ${modelInfo.capabilities?.join(', ') || 'none'}`);
  console.log();
}

describe.skipIf(!modelInfo || !providerId)("Testing a model", () => {
  if (!modelInfo) {
    it.skip("Model not found or not specified");
    return;
  }

  if (!providerId) {
    it.skip("Provider could not be determined for this model");
    return;
  }

  // Determine which tests to run based on capabilities
  const hasChat = modelInfo.capabilities?.includes('chat') || false;
  const hasVision = modelInfo.capabilities?.includes('img-in') || false;
  const hasTools = modelInfo.capabilities?.includes('fn-out') || false;
  const hasReasoning = modelInfo.capabilities?.includes('reason') || false;
  
  // Get API key from environment
  const apiKeyEnvMap: Record<string, string> = {
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'google': 'GOOGLE_API_KEY',
    'deepseek': 'DEEPSEEK_API_KEY',
    'openrouter': 'OPENROUTER_API_KEY',
    'xai': 'XAI_API_KEY',
  };
  
  const apiKeyEnv = apiKeyEnvMap[providerId.toLowerCase()];
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;

  if (!apiKey) {
    it.skip(`API key not found (need ${apiKeyEnv})`);
    return;
  }

  // Create Lang instance based on provider
  let lang: any;
  try {
    switch (providerId.toLowerCase()) {
      case 'openai':
        lang = Lang.openai({ apiKey, model: modelInfo.id });
        break;
      case 'anthropic':
        lang = Lang.anthropic({ apiKey, model: modelInfo.id });
        break;
      case 'google':
        lang = Lang.google({ apiKey, model: modelInfo.id });
        break;
      case 'deepseek':
        lang = Lang.deepseek({ apiKey, model: modelInfo.id });
        break;
      case 'openrouter':
        lang = Lang.openrouter({ apiKey, model: modelInfo.id });
        break;
      case 'xai':
        lang = Lang.xai({ apiKey, model: modelInfo.id });
        break;
      default:
        it.skip(`Provider ${providerId} not yet supported in test`);
        return;
    }
  } catch (error) {
    it.skip(`Failed to create Lang instance: ${error}`);
    return;
  }

  if (hasChat) {
    it("should respond to a simple chat message", async () => {
      const result = await lang.ask("Say 'Hello' and nothing else.");
      expect(result.answer.toLowerCase()).toContain('hello');
    });
  }

  // Add more tests based on capabilities...
});