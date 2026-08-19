import {
  isLangToolResultContent,
  type LangToolWithHandler,
  type ToolRequest,
} from "../lang/messages.js";
import {
  executeLangToolCall,
  isLangToolWithHandler,
  type LangToolExecutionResult,
} from "../lang/tool-execution.js";
import type { SpeechToSpeechSessionOptions } from "./types.js";

export type SpeechToSpeechFunctionDeclaration = Pick<
  LangToolWithHandler,
  "name" | "description" | "parameters"
>;

export function speechToSpeechFunctionDeclarations(
  options: SpeechToSpeechSessionOptions,
): SpeechToSpeechFunctionDeclaration[] {
  const tools = options.tools ?? [];
  const unsupported = tools.filter((tool) => !isLangToolWithHandler(tool));
  if (unsupported.length) {
    throw new Error(
      `Native speech sessions only support local function tools with handlers. Unsupported tools: ${unsupported.map((tool) => tool.name).join(", ")}`,
    );
  }
  return tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

export async function executeSpeechToSpeechToolCall(
  options: SpeechToSpeechSessionOptions,
  call: ToolRequest,
  signal: AbortSignal,
): Promise<LangToolExecutionResult> {
  options.onEvent?.({ type: "tool-call", call });
  let result = await executeLangToolCall(call, options.tools, { signal });
  try {
    serializeSpeechToSpeechToolResult(result.result);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    result = {
      callId: call.callId,
      name: call.name,
      result: {
        error: true,
        name: normalized.name,
        message: normalized.message,
      },
    };
  }
  options.onEvent?.({ type: "tool-result", result });
  return result;
}

export function parseSpeechToSpeechToolCall(
  callId: unknown,
  name: unknown,
  argumentsValue: unknown,
): ToolRequest | undefined {
  if (typeof callId !== "string" || !callId) return undefined;
  if (typeof name !== "string" || !name) return undefined;

  let parsed: unknown = argumentsValue ?? {};
  if (typeof argumentsValue === "string") {
    if (!argumentsValue.trim()) return { callId, name, arguments: {} };
    try {
      parsed = JSON.parse(argumentsValue);
    } catch (error) {
      throw new Error(
        `Live tool "${name}" returned invalid JSON arguments`,
        { cause: error },
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Live tool "${name}" arguments must be a JSON object`,
    );
  }
  const args = parsed as Record<string, any>;
  return { callId, name, arguments: args };
}

export function serializeSpeechToSpeechToolResult(result: unknown): string {
  if (isLangToolResultContent(result)) {
    if (result.content.some((part) => part.type === "image")) {
      throw new Error(
        "Native speech tool results do not support image content yet",
      );
    }
    return result.content
      .map((part) => part.type === "text" ? part.text : "")
      .join("\n");
  }
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result ?? {});
  } catch {
    throw new Error("Native speech tool results must be JSON-serializable");
  }
}

export function jsonSpeechToSpeechToolResult(result: unknown): unknown {
  const serialized = serializeSpeechToSpeechToolResult(result);
  if (isLangToolResultContent(result) || typeof result === "string") {
    return serialized;
  }
  return JSON.parse(serialized) as unknown;
}
