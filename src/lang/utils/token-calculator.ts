import { Model } from "aimodels";

// Rough estimate: 1 token ≈ 4 chars for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate the maximum number of tokens available for model response
 */
export function calculateModelResponseTokens(
  model: Model,
  messages: Array<{ role: string; content: string }>,
  maxTokens?: number
): number {
  // If user specified maxTokens, use that
  if (maxTokens) {
    return maxTokens;
  }

  // Get model context
  if (model.context.type !== "token") {
    // Non-token contexts aren't handled, return a reasonable default
    return 2000;
  }

  const context = model.context;
  
  // If model has fixed output capacity (like Anthropic models)
  if (context.outputIsFixed === 1 && context.maxOutput) {
    return context.maxOutput;
  }
  
  // If model has dynamic output capacity that shares with input
  if (context.total && context.maxOutput) {
    // Estimate tokens used by messages
    const inputTokens = messages.reduce((sum, message) => {
      return sum + estimateTokens(message.content) + 4; // +4 tokens for message overhead
    }, 0);
    
    // Calculate remaining tokens in context window
    const remainingTokens = context.total - inputTokens;
    
    // Cap at model's maxOutput or available tokens, whichever is smaller
    return Math.max(0, Math.min(context.maxOutput, remainingTokens));
  }
  
  // If we don't have enough information, return a reasonable default
  return context.maxOutput || 2000;
} 