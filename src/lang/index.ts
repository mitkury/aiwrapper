import { Lang } from "./lang.ts";
import { LangVecs } from "./lang-vecs.ts";
import { 
  LanguageProvider, 
  LangResult, 
  LangOptions, 
  LangChatMessage,
  LangChatMessageCollection,
  Tool,
  ToolRequest,
  ToolResult
} from "./language-provider.ts";

// Export classes
export { Lang, LangVecs, LanguageProvider, LangResult, LangChatMessageCollection };

// Export types
export type { LangOptions, LangChatMessage, Tool, ToolRequest, ToolResult };

// For backward compatibility
export type LangChatMessages = LangChatMessageCollection;