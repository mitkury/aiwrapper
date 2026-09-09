import extractJSON from "./json/extract-json.js";
import { executeLangToolCall } from "./tool-execution.js";
import { attachPartialResult, isAbortError } from "../errors.js";
import { encodeBytesAsBase64 } from "../base64.js";

export type LangMessageRole = "user" | "assistant" | "tool-results";
export type LangMessageContent = string | LangContentPart[] | ToolRequest[] | ToolResult[];
export type LangMessageMeta = Record<string, any>;

export type LangContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: LangContentImage; alt?: string }
  | { type: "reasoning"; text: string };

/**
 * Interface for tool requests that can be sent to language models
 */
export interface ToolRequest {
  callId: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Interface for tool execution results
 */
export interface ToolResult {
  toolId: string;
  name: string;
  result: any;
}

export type LangContentImage =
  | { kind: "url"; url: string }
  | { kind: "base64"; base64: string; mimeType?: string }
  | { kind: "bytes"; bytes: ArrayBuffer | Uint8Array; mimeType?: string }
  | { kind: "blob"; blob: Blob; mimeType?: string };

export type LangToolResultTextPart = {
  type: "text";
  text: string;
};

type LangToolResultImagePartBase = {
  type: "image";
  mimeType?: string;
  detail?: "auto" | "low" | "high" | "original";
};

export type LangToolResultImagePart = LangToolResultImagePartBase & (
  | { url: string; base64?: never; bytes?: never }
  | { base64: string; url?: never; bytes?: never }
  | { bytes: ArrayBuffer | Uint8Array; url?: never; base64?: never }
);

export type LangToolResultPart =
  | LangToolResultTextPart
  | LangToolResultImagePart;

/**
 * Explicit multimodal content returned by a local tool handler.
 *
 * Plain handler return values retain their existing JSON/text behavior. Use
 * `toolResult` only when the provider should receive content parts directly.
 */
export type LangToolResultContent = {
  type: "tool-content";
  content: LangToolResultPart[];
};

type NormalizedLangToolResultImage =
  | { kind: "url"; url: string }
  | { kind: "base64"; base64: string; mimeType: string };

export function toolResult(
  content: LangToolResultPart | LangToolResultPart[],
): LangToolResultContent {
  const parts = Array.isArray(content) ? [...content] : [content];
  if (parts.length === 0) {
    throw new Error("A multimodal tool result must contain at least one content part.");
  }
  return { type: "tool-content", content: parts };
}

export function isLangToolResultContent(value: unknown): value is LangToolResultContent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LangToolResultContent>;
  return candidate.type === "tool-content" && Array.isArray(candidate.content);
}

export function normalizeLangToolResultImage(
  image: LangToolResultImagePart,
): NormalizedLangToolResultImage {
  if (typeof image.url === "string" && image.url.length > 0) {
    if (!image.url.startsWith("data:")) {
      return { kind: "url", url: image.url };
    }

    const match = image.url.match(/^data:([^;,]+);base64,(.*)$/s);
    if (!match || match[2].length === 0) {
      throw new Error("Tool result image contains an invalid base64 data URL.");
    }
    return { kind: "base64", mimeType: match[1], base64: match[2] };
  }

  if (typeof image.base64 === "string" && image.base64.length > 0) {
    return {
      kind: "base64",
      base64: image.base64,
      mimeType: image.mimeType || "image/png",
    };
  }

  if (image.bytes instanceof ArrayBuffer || image.bytes instanceof Uint8Array) {
    return {
      kind: "base64",
      base64: encodeBytesAsBase64(image.bytes),
      mimeType: image.mimeType || "image/png",
    };
  }

  throw new Error("Tool result image must include a non-empty URL, base64 value, or byte array.");
}

export type LangImageOutput = {
  url?: string;
  base64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Built-in tools provided by the language model provider
 * These tools don't require handlers as they're executed by the provider
 */
export type BuiltInLangTool = {
  name: string;
  [key: string]: any;
};

/**
 * Union type for all tool types: custom functions with handlers and built-in provider tools
 */
export type LangTool = LangToolWithHandler | BuiltInLangTool;

export type LangToolHandlerContext = {
  callId: string;
  name: string;
  signal?: AbortSignal;
};

export type LangToolWithHandler = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (
    args: Record<string, any>,
    context: LangToolHandlerContext,
  ) => any | Promise<any>;
};

export type LangMessageItem =
  | LangMessageItemText
  | LangMessageItemReasoning
  | LangMessageItemImage
  | LangMessageItemTool
  | LangMessageItemToolResult;

export type LangMessageItemText = {
  type: "text";
  text: string;
};

export type LangMessageItemReasoning = {
  type: "reasoning";
  text: string;
};

export type LangMessageItemImage = LangImageOutput & {
  type: "image";
};

export type LangMessageItemTool = {
  type: "tool";
  name: string;
  callId: string;
  arguments: Record<string, any>;
};

export type LangMessageItemToolResult = {
  type: "tool-result";
  name: string;
  callId: string;
  result: any;
};

export class LangMessage {
  role: LangMessageRole;
  items: LangMessageItem[];
  meta?: LangMessageMeta;

  constructor(role: LangMessageRole, text: string, meta?: LangMessageMeta);
  constructor(role: LangMessageRole, items: LangMessageItem[], meta?: LangMessageMeta);
  constructor(
    role: LangMessageRole,
    init: string | LangMessageItem[],
    meta?: LangMessageMeta
  ) {
    this.role = role;
    this.items = Array.isArray(init) ? init : [{ type: "text", text: init }];
    this.meta = meta;
  }

  get text(): string {
    return this.items.filter(item => item.type === "text").map(item => item.text).join("\n\n");
  }

  get reasoning(): string {
    return this.items.filter(item => item.type === "reasoning").map(item => item.text).join("\n\n");
  }

  get object(): any | null {
    const text = this.text;
    if (text && text.length > 0) return extractJSON(text);
    return null;
  }

  get toolRequests(): LangMessageItemTool[] {
    return this.items.filter(
      (item): item is LangMessageItemTool => item.type === "tool",
    );
  }

  get toolResults(): LangMessageItemToolResult[] {
    return this.items.filter(
      (item): item is LangMessageItemToolResult => item.type === "tool-result",
    );
  }

  get images(): LangMessageItemImage[] {
    return this.items.filter(
      (item): item is LangMessageItemImage => item.type === "image",
    );
  }
}

export class LangMessages extends Array<LangMessage> {
  availableTools?: LangTool[];
  finished: boolean = false;
  aborted: boolean = false;
  instructions?: string;

  constructor();
  constructor(initialPrompt: string, opts?: { tools?: LangTool[] });
  constructor(initialMessages: LangMessage[], opts?: { tools?: LangTool[] });
  constructor(initialMessages: LangMessages, opts?: { tools?: LangTool[] });
  constructor(initialMessages: { role: LangMessageRole; items: LangMessageItem[]; meta?: Record<string, any>; }[], opts?: { tools?: LangTool[] });
  constructor(
    initial?: string | { role: LangMessageRole; items: LangMessageItem[]; meta?: Record<string, any>; }[] | LangMessage[] | LangMessages,
    opts?: { tools?: LangTool[] }
  ) {
    super();
    if (typeof initial === "string") {
      this.addUserMessage(initial);
    } else if (initial instanceof LangMessages) {
      for (const m of initial) {
        this.push(m);
      }
      this.instructions = initial.instructions;
      this.finished = initial.finished;
      this.aborted = initial.aborted;
      // Messages and tools are shared intentionally. This is a shallow copy of
      // the conversation container, not a clone of user-owned values.
      this.availableTools = initial.availableTools;
    } else if (Array.isArray(initial)) {
      for (const m of initial) {
        if (m instanceof LangMessage) {
          this.push(m);
        } else {
          this.push(new LangMessage(m.role, m.items, m.meta));
        }
      }
    }
    if (opts?.tools) {
      this.availableTools = opts.tools;
    }
  }

  /**
   * Last assistant message as text
   */
  get answer(): string {
    for (let i = this.length - 1; i >= 0; i--) {
      const msg = this[i];
      if (msg.role === "assistant") {
        return msg.text;
      }
    }
    return "";
  }

  get object(): any | null {
    const answer = this.answer;
    if (answer.length > 0) {
      return extractJSON(answer);
    }
    return null;
  }

  get assistantImages(): LangImageOutput[] {
    return this.getImagesFromLastMessage("assistant");
  }

  get userImages(): LangImageOutput[] {
    return this.getImagesFromLastMessage("user");
  }

  private getImagesFromLastMessage(role: "assistant" | "user"): LangImageOutput[] {
    let lastMessageByRole: LangMessage | undefined;
    for (let i = this.length - 1; i >= 0; i--) {
      if (this[i].role === role) { lastMessageByRole = this[i]; break; }
    }
    if (!lastMessageByRole) return [];

    return lastMessageByRole.images;
  }

  addUserMessage(content: string): this {
    this.push(new LangMessage("user", content));
    return this;
  }

  addUserItems(items: LangMessageItem[]): this {
    this.push(new LangMessage("user", items));
    return this;
  }

  addToolResultsMessage(items: LangMessageItemToolResult[]): this {
    this.push(new LangMessage("tool-results", items));
    return this;
  }

  addUserImages(image: LangContentImage): this;
  addUserImages(images: LangContentImage[]): this;
  addUserImages(imageOrImages: LangContentImage | LangContentImage[]): this {
    const images = Array.isArray(imageOrImages) ? imageOrImages : [imageOrImages];
    const items = images.map(image => this.createImageMessageItem(image));
    return this.addUserItems(items);
  }

  private createImageMessageItem(image: LangContentImage): LangMessageItemImage {
    switch (image.kind) {
      case "url":
        return { type: "image", url: image.url };
      case "base64":
        return { type: "image", base64: image.base64, mimeType: image.mimeType };
      case "bytes":
        return {
          type: "image",
          base64: encodeBytesAsBase64(image.bytes),
          mimeType: image.mimeType
        };
      case "blob":
        throw new Error("LangMessages.addUserImages does not support Blob inputs yet. Convert the Blob to base64 or a URL first.");
      default:
        throw new Error("Unsupported image input type.");
    }
  }

  addAssistantMessage(content: string, meta?: Record<string, any>): this {
    this.push(new LangMessage("assistant", content, meta));
    return this;
  }

  addAssistantItems(items: LangMessageItem[], meta?: Record<string, any>): this {
    this.push(new LangMessage("assistant", items, meta));
    return this;
  }

  async executeRequestedTools(options: {
    tools?: LangTool[];
    signal?: AbortSignal;
  } = {}): Promise<LangMessage | null> {
    // Only execute tool requests from the last assistant message.
    const last = this.length > 0 ? this[this.length - 1] : undefined;
    if (!last || last.role !== "assistant" || last.items.length === 0) {
      return null;
    }

    const toolRequests = last.toolRequests;
    if (toolRequests.length === 0) {
      return null;
    }

    const toolResults: LangMessageItemToolResult[] = [];
    try {
      for (const requestedTool of toolRequests) {
        if (!requestedTool.name) continue;
        const executed = await executeLangToolCall(
          requestedTool,
          options.tools ?? this.availableTools ?? [],
          { signal: options.signal },
        );
        toolResults.push({ type: "tool-result", ...executed });
      }
    } catch (error) {
      if (isAbortError(error)) {
        this.aborted = true;
        throw attachPartialResult(error, this);
      }
      throw error;
    } finally {
      // Completed tools may have side effects. Retain their results even when
      // a later tool is cancelled, so resuming cannot mistake them for aborted calls.
      if (toolResults.length) this.addToolResultsMessage(toolResults);
    }

    if (toolResults.length === 0) return null;
    return this[this.length - 1];
  }

  toString(): string {
    const out: string[] = [];
    for (const msg of this) {
      out.push(`${msg.role}: ${JSON.stringify(msg.items, null, 2)}`);
    }
    return out.join("\n\n");
  }
}

/**
 * Ensure every assistant tool call has a follow-up tool-results message to keep provider chains valid.
 */
export function fixToolResultsIfNeeded(messages: LangMessages | LangMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    const toolRequests = message.toolRequests;
    if (toolRequests.length === 0) continue;

    const nextMessage = messages[i + 1];
    const completedCallIds = new Set(
      nextMessage?.role === "tool-results"
        ? nextMessage.toolResults.map(result => result.callId)
        : [],
    );
    const missingToolRequests = toolRequests.filter(
      toolRequest => !completedCallIds.has(toolRequest.callId),
    );
    if (missingToolRequests.length === 0) continue;

    const missingResults: LangMessageItemToolResult[] = missingToolRequests.map((toolRequest) => ({
      type: "tool-result",
      name: toolRequest.name,
      callId: toolRequest.callId,
      result: "aborted",
    }));

    if (nextMessage?.role === "tool-results") {
      nextMessage.items.push(...missingResults);
    } else {
      const toolResultsMessage = new LangMessage("tool-results", missingResults);
      (messages as LangMessage[]).splice(i + 1, 0, toolResultsMessage);
      i += 1;
    }

    const toolNames = missingToolRequests.map(tool => `"${tool.name}"`).join(", ");
    console.warn(`Inserted missing tool results for ${toolNames}.`);
  }
}
