import type {
  LangTool,
  LangToolWithHandler,
  LangMessageItemToolResult,
  ToolRequest,
} from "./messages.js";
import { isAbortError, normalizeError, throwIfAborted } from "../errors.js";
import { validateAgainstSchema } from "./schema/schema-utils.js";

export type LangToolExecutionResult = Omit<LangMessageItemToolResult, "type">;

export function isLangToolWithHandler(
  tool: LangTool,
): tool is LangToolWithHandler {
  return "handler" in tool && typeof tool.handler === "function";
}

export async function executeLangToolCall(
  call: ToolRequest,
  tools: LangTool[] = [],
  options: { signal?: AbortSignal } = {},
): Promise<LangToolExecutionResult> {
  throwIfAborted(options.signal);
  const localTools = tools.filter(isLangToolWithHandler);
  const tool = localTools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return {
      callId: call.callId,
      name: call.name,
      result: {
        error: true,
        name: "ToolNotFound",
        message: `Tool "${call.name}" is not available. Available tools: ${localTools.map((candidate) => candidate.name).join(", ") || "none"}`,
      },
    };
  }

  let result: any;
  try {
    if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
      throw new Error(`Tool "${call.name}" arguments must be a JSON object`);
    }
    const validation = validateAgainstSchema(call.arguments, tool.parameters);
    if (!validation.valid) {
      throw new Error(`Invalid arguments for tool "${call.name}": ${validation.errors.join("; ")}`);
    }
    // Preserve the actual outcome even if cancellation arrives during execution.
    // Callers stop further work after recording it; cancellation cannot undo a side effect.
    result = await tool.handler(call.arguments, {
      callId: call.callId,
      name: call.name,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw normalizeError(error);
    const normalizedError = normalizeError(error);
    result = {
      ...Object.fromEntries(Object.entries(normalizedError)),
      error: true,
      name: normalizedError.name,
      message: normalizedError.message,
    };
  }

  return { callId: call.callId, name: call.name, result };
}
