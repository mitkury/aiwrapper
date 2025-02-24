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

  // Otherwise return a reasonable default
  return 2000;
} 