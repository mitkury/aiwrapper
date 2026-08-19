import type {
  LangTool,
  LangToolWithHandler,
  ToolRequest,
} from "./messages.js";

export type LangToolExecutionResult = {
  callId: string;
  name: string;
  result: any;
};

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
      throw isAbortError(error) ? error : createAbortError();
    }
    const normalizedError = error instanceof Error
      ? error
      : new Error(String(error));
    result = {
      ...Object.fromEntries(Object.entries(normalizedError)),
      error: true,
      name: normalizedError.name,
      message: normalizedError.message,
    };
  }

  return { callId: call.callId, name: call.name, result };
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}
