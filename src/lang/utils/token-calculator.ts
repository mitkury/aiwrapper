import { Model, type TokenContext } from "../../aimodels/index.js";
import { LangMessage } from "../messages.js";

// Rough estimate: 1 token ≈ 4 chars for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate the maximum number of tokens available for model response.
 * Returns undefined when neither the caller nor the catalog sets a limit, so
 * the provider's own default applies.
 */
export function calculateModelResponseTokens(
  model: Model,
  messages: Array<{ role: string; text: string } | LangMessage>,
  maxTokens?: number
): number | undefined {
  const modelContext = model.context;
  if (modelContext?.type !== "token") {
    // Non-token contexts aren't handled; keep only the caller's limit
    return maxTokens || undefined;
  }

  const context: TokenContext = modelContext;
  
  // For models with fixed output capacity (like Anthropic models)
  if (context.outputIsFixed === 1 && context.maxOutput) {
    // If user specified maxTokens, clamp it to model's maxOutput
    if (maxTokens) {
      return Math.min(maxTokens, context.maxOutput);
    }
    return context.maxOutput;
  }
  
  // For models with dynamic output capacity that shares with input
  if (context.total && context.maxOutput) {
    // Estimate tokens used by messages
    const inputTokens = messages.reduce((sum, message) => {
      if (message.text.length === 0) return sum;
      return sum + estimateTokens(message.text) + 4; // +4 tokens for message overhead
    }, 0);
    
    // Calculate remaining tokens in context window
    const remainingTokens = context.total - inputTokens;
    
    // If user specified maxTokens, respect it, but also respect model limits
    if (maxTokens) {
      return Math.max(0, Math.min(maxTokens, context.maxOutput, remainingTokens));
    }
    
    // Otherwise use the maximum available within limits
    return Math.max(0, Math.min(context.maxOutput, remainingTokens));
  }
  
  // Without a listed total, use the caller's limit or the model's output limit
  return maxTokens || context.maxOutput || undefined;
}
