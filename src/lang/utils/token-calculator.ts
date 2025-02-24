import { LangChatMessages } from "../language-provider.ts";
import { Model, ModelContext } from "aimodels";

// Rough estimate: 1 token ≈ 4 chars for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Type guard to check if context is token-based
function isTokenContext(context: ModelContext): context is { 
  total: number | null; 
  maxOutput: number | null;
  outputIsFixed?: 1;
} {
  return 'total' in context;
}

/**
 * Calculate the maximum number of tokens available for model response
 * based on the model's context window, input messages, and optional user limit
 */
export function calculateModelResponseTokens(
  modelInfo: Model,
  messages: LangChatMessages,
  userMaxTokens?: number
): number {
  // Check if we have a token-based model context
  if (!isTokenContext(modelInfo.context)) {
    throw new Error(`Cannot calculate tokens for non-token based model: ${modelInfo.id}`);
  }

  // If the model has fixed output length, return maxOutput directly
  if (modelInfo.context.outputIsFixed === 1) {
    return modelInfo.context.maxOutput || 1000;
  }

  // Calculate estimated tokens in messages
  const estimatedInputTokens = messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content);
  }, 0);

  // Add some overhead for message formatting (roles, etc)
  const overhead = messages.length * 4;

  // Get context window size, defaulting to a conservative value if not specified
  const contextWindow = modelInfo.context.total || 4000;
  const maxOutput = modelInfo.context.maxOutput || 1000;

  // Calculate available tokens based on model's context window
  const availableTokens = contextWindow - estimatedInputTokens - overhead;

  // Get the smallest of:
  // 1. Available tokens (what's left in context window)
  // 2. Model's max output capability
  // 3. User-specified limit (if any)
  const maxTokens = userMaxTokens
    ? Math.min(availableTokens, maxOutput, userMaxTokens)
    : Math.min(availableTokens, maxOutput);

  return maxTokens;
} 