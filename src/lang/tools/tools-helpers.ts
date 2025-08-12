import { LanguageProvider, LangResult, ToolRequest, ToolResult, LangOptions } from "../language-provider.ts";

export type ToolRegistry = Record<string, (args: Record<string, any>) => any | Promise<any>>;

/**
 * Executes tool calls from a LangResult using the provided registry, appends tool results,
 * and continues the conversation by invoking provider.chat with the updated messages.
 */
export async function executeToolsAndContinue(
  provider: LanguageProvider,
  result: LangResult,
  registry: ToolRegistry,
  options?: LangOptions
): Promise<LangResult> {
  const toolCalls: ToolRequest[] = result.tools || [];
  if (toolCalls.length === 0) {
    // No tools requested; return the same result
    return result;
  }

  const toolResults: ToolResult[] = [];

  for (const call of toolCalls) {
    const toolName = (call as any).name as string | undefined;
    if (!toolName || !(toolName in registry)) {
      // Skip unknown tools but keep the flow robust
      continue;
    }
    const fn = registry[toolName];
    const outcome = await Promise.resolve(fn(call.arguments || {}));
    toolResults.push({ toolId: call.id, result: outcome });
  }

  // Append tool execution results as a tool message to the conversation
  result.addToolUseMessage(toolResults);

  // Continue the chat with updated messages
  const continued = await provider.chat(result.messages, options);
  return continued;
}