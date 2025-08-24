import { LanguageProvider, ToolRequest, ToolResult, LangOptions } from "../language-provider.ts";
import { LangMessages } from "../messages.ts";

export type ToolRegistry = Record<string, (args: Record<string, any>) => any | Promise<any>>;

// @TODO: I guess it should be internal, used automatically when running the lang.chat();

/**
 * Executes tool calls from LangMessages using the provided registry, appends tool results,
 * and continues the conversation by invoking provider.chat with the updated messages.
 */
export async function executeToolsAndContinue(
  provider: LanguageProvider,
  messages: LangMessages,
  registry: ToolRegistry,
  options?: LangOptions
): Promise<LangMessages> {
  const toolCalls: ToolRequest[] = messages.toolsRequested || [];
  if (toolCalls.length === 0) {
    return messages;
  }

  const toolResults: ToolResult[] = [];

  for (const call of toolCalls) {
    const toolName = (call as any).name as string | undefined;
    if (!toolName || !(toolName in registry)) {
      continue;
    }
    const fn = registry[toolName];
    const outcome = await Promise.resolve(fn(call.arguments || {}));
    toolResults.push({ toolId: call.id, result: outcome });
  }

  messages.addToolUseMessage(toolResults);

  const continued = await provider.chat(messages, options);
  return continued;
}