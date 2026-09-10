import type {
  LangTool,
  LangToolWithHandler,
  LangMessageItemToolResult,
  ToolRequest,
} from "./messages.js";
import { createAbortError, isAbortError, normalizeError, throwIfAborted } from "../errors.js";

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
    result = await Promise.resolve(
      tool.handler(call.arguments || {}, {
        callId: call.callId,
        name: call.name,
        signal: options.signal,
      }),
    );
    throwIfAborted(options.signal);
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      throw isAbortError(error) ? normalizeError(error) : createAbortError();
    }
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
