import { Lang } from "./lang.js";
import { MockOpenAILikeLang } from "./mock/mock-openai-like-lang.js";
import { MockResponseStreamLang } from "./mock/mock-response-stream-lang.js";
import {
  LanguageProvider,
  LangResult,
  z,
} from "./language-provider.js";
import type { LangOptions, LangResponseSchema } from "./language-provider.js";
// Export classes
export { Lang, LanguageProvider, LangResult, z, MockOpenAILikeLang, MockResponseStreamLang };

export * from "./messages.js";
export * from "./tool-execution.js";

// Export types
export type { LangOptions, LangResponseSchema };
export type {
  LangToolWithHandler,
  LangToolHandlerContext,
  ToolRequest,
  ToolResult,
  LangTool,
} from "./messages.js";
export type { MockOpenAILikeOptions } from "./mock/mock-openai-like-lang.js";
export type { MockResponseStreamOptions } from "./mock/mock-response-stream-lang.js";

// Re-export image and content part types
export type { LangImageInput, LangContentPart, LangImageOutput } from "./language-provider.js";

// Utils
export * from "./utils/index.js";

// OpenAI-specific utilities
export { applyDiff_v4a } from "./openai/utils/index.js";

// Img API
export { Img } from "../img/img.js";
