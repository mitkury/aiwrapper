import { Model } from "aimodels";
import { LangMessage } from "../messages";

// Rough estimate: 1 token ≈ 4 chars for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate the maximum number of tokens available for model response
 */
export function calculateModelResponseTokens(
  model: Model,
  messages: Array<{ role: string; content: string } | LangMessage>,
  maxTokens?: number
): number {
  // Get model context
  if (model.context.type !== "token") {
    // Non-token contexts aren't handled, return user maxTokens or a reasonable default
    return maxTokens || 4000;
  }

  const context = model.context;
  
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
      if (!message.content || typeof message.content !== "string") return sum;
      return sum + estimateTokens(message.content) + 4; // +4 tokens for message overhead
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
  
  // If we don't have enough information, return user maxTokens or a reasonable default
  return maxTokens || context.maxOutput || 4000;
} 