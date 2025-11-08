import extractJSON from "./json/extract-json";

export type LangMessageRole = "user" | "assistant" | "system";
export type LangMessageContent = string | LangContentPart[] | ToolRequest[] | ToolResult[];
export type LangMessageMeta = Record<string, any>;
//export type LangMessageMetaValue = string | number | boolean | null | LangMessageMetaValue[];

export type LangContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: LangContentImage; alt?: string }
  | { type: "thinking"; text: string };

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

export type LangImageOutput = {
  url?: string;
  base64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, any>;
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

export type LangToolWithHandler = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: Record<string, any>) => any | Promise<any>;
}

export type LangMessageItem =
  | LangMessageItemText
  | LangMessageItemImage
  | LangMessageItemThinking
  | LangMessageItemTool
  | LangMessageItemToolResult;

export type LangMessageItemText = {
  type: "text";
  text: string;
}

export type LangMessageItemImage = {
  type: "image";
  url?: string;
  base64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, any>;
}

export type LangMessageItemThinking = {
  type: "thinking";
  text: string;
}

export type LangMessageItemTool = {
  type: "tool";
  name: string;
  callId: string;
  arguments: Record<string, any>;
}

export type LangMessageItemToolResult = {
  type: "tool-result";
  name: string;
  callId: string;
  result: any;
}

const TEXT_JOIN_SEPARATOR = "\n\n";

function createTextItem(text: string): LangMessageItemText {
  return { type: "text", text };
}

function createThinkingItem(text: string): LangMessageItemThinking {
  return { type: "thinking", text };
}

function createToolCallItem(callId: string, name: string, args: Record<string, any>): LangMessageItemTool {
  return { type: "tool", callId, name, arguments: args };
}

function createToolResultItem(callId: string, name: string, result: any): LangMessageItemToolResult {
  return { type: "tool-result", callId, name, result };
}

function isToolRequest(value: any): value is ToolRequest {
  return value && typeof value === "object" && typeof value.name === "string" && ("callId" in value || "id" in value);
}

function isToolResult(value: any): value is ToolResult {
  return value && typeof value === "object" && ("toolId" in value || "callId" in value) && "result" in value;
}

function mapImageInputToItem(image: LangContentImage | LangImageOutput | LangMessageItemImage): LangMessageItemImage {
  if (!image) return { type: "image" };

  if ((image as LangMessageItemImage).type === "image") {
    const imageItem = image as LangMessageItemImage;
    return {
      type: "image",
      url: imageItem.url,
      base64: imageItem.base64,
      mimeType: imageItem.mimeType,
      width: imageItem.width,
      height: imageItem.height,
      metadata: imageItem.metadata,
    };
  }

  const value = image as LangContentImage | LangImageOutput;
  if ("kind" in value) {
    switch (value.kind) {
      case "url":
        return { type: "image", url: value.url };
      case "base64":
        return { type: "image", base64: value.base64, mimeType: value.mimeType };
      case "bytes":
        return {
          type: "image",
          metadata: { kind: "bytes", bytes: value.bytes, mimeType: value.mimeType },
        };
      case "blob":
        return {
          type: "image",
          metadata: { kind: "blob", blob: value.blob, mimeType: value.mimeType },
        };
      default:
        return { type: "image", metadata: { original: value } };
    }
  }

  return {
    type: "image",
    url: value.url,
    base64: value.base64,
    mimeType: value.mimeType,
    width: value.width,
    height: value.height,
    metadata: value.metadata,
  };
}

function mapItemImageToContentImage(item: LangMessageItemImage): LangContentImage {
  if (item.url) {
    return { kind: "url", url: item.url };
  }
  if (item.base64) {
    return { kind: "base64", base64: item.base64, mimeType: item.mimeType };
  }
  if (item.metadata?.kind === "bytes") {
    return { kind: "bytes", bytes: item.metadata.bytes, mimeType: item.metadata.mimeType };
  }
  if (item.metadata?.kind === "blob") {
    return { kind: "blob", blob: item.metadata.blob, mimeType: item.metadata.mimeType };
  }

  if (item.metadata?.original?.url) {
    return { kind: "url", url: item.metadata.original.url };
  }
  if (item.metadata?.original?.base64) {
    return { kind: "base64", base64: item.metadata.original.base64, mimeType: item.metadata.original.mimeType };
  }

  return { kind: "base64", base64: item.base64 ?? "", mimeType: item.mimeType };
}

function convertEntryToItem(entry: any): LangMessageItem | null {
  if (entry == null) return null;

  if (typeof entry === "string") {
    if (entry.length === 0) return null;
    return createTextItem(entry);
  }

  if (isToolRequest(entry)) {
    const callId = String((entry as any).callId ?? (entry as any).id ?? "");
    return createToolCallItem(callId, entry.name ?? "", entry.arguments ?? {});
  }

  if (isToolResult(entry)) {
    const callId = String((entry as any).callId ?? (entry as any).toolId ?? "");
    return createToolResultItem(callId, entry.name ?? "", entry.result);
  }

  const type = typeof entry.type === "string" ? entry.type : undefined;

  if (type === "text") {
    return createTextItem(entry.text ?? "");
  }

  if (type === "thinking") {
    return createThinkingItem(entry.text ?? "");
  }

  if (type === "image") {
    if ("url" in entry || "base64" in entry || "metadata" in entry) {
      return entry as LangMessageItemImage;
    }
    if ("image" in entry && entry.image) {
      return mapImageInputToItem(entry.image as LangContentImage);
    }
    return mapImageInputToItem(entry as LangMessageItemImage);
  }

  if (type === "tool") {
    const callId = String(entry.callId ?? entry.id ?? "");
    const name = entry.name ?? "";
    const args = entry.arguments ?? {};
    return createToolCallItem(callId, name, args);
  }

  if (type === "tool-result") {
    const callId = String(entry.callId ?? entry.toolId ?? entry.id ?? "");
    const name = entry.name ?? "";
    return createToolResultItem(callId, name, entry.result);
  }

  if ("callId" in entry || "arguments" in entry) {
    const callId = String((entry as any).callId ?? (entry as any).id ?? "");
    const name = (entry as any).name ?? "";
    const args = (entry as any).arguments ?? {};
    return createToolCallItem(callId, name, args);
  }

  if ("toolId" in entry || "result" in entry) {
    const callId = String((entry as any).callId ?? (entry as any).toolId ?? "");
    const name = (entry as any).name ?? "";
    const result = (entry as any).result;
    return createToolResultItem(callId, name, result);
  }

  if ("image" in entry) {
    return mapImageInputToItem(entry.image as LangContentImage);
  }

  if (entry.url || entry.base64) {
    return mapImageInputToItem(entry as LangMessageItemImage);
  }

  return createTextItem(String(entry));
}

function toItems(init?: string | LangMessageItem[] | LangMessageContent | null): LangMessageItem[] {
  if (init == null) return [];

  if (typeof init === "string") {
    if (init.length === 0) return [];
    return [createTextItem(init)];
  }

  if (Array.isArray(init)) {
    if (init.length === 0) return [];

    const out: LangMessageItem[] = [];
    for (const entry of init) {
      const item = convertEntryToItem(entry);
      if (item) out.push(item);
    }
    return out;
  }

  if (typeof init === "object") {
    const item = convertEntryToItem(init);
    if (item) return [item];
    if ((init as any).type === "text" || (init as any).type === "thinking" || (init as any).type === "image") {
      return toItems([(init as LangContentPart) as any]);
    }
  }

  return [createTextItem(String(init))];
}

function itemsToLegacyContent(items: LangMessageItem[]): LangMessageContent {
  if (items.length === 0) return "";

  const hasTool = items.some((item) => item.type === "tool");
  const hasToolResults = items.some((item) => item.type === "tool-result");

  const parts: LangContentPart[] = [];
  let onlyText = true;
  for (const item of items) {
    if (item.type === "text") {
      parts.push({ type: "text", text: item.text });
    } else if (item.type === "thinking") {
      parts.push({ type: "thinking", text: item.text });
      onlyText = false;
    } else if (item.type === "image") {
      const image = mapItemImageToContentImage(item);
      parts.push({ type: "image", image });
      onlyText = false;
    }
  }

  if (parts.length > 0) {
    if (onlyText) {
      return parts.map((part) => (part.type === "text" ? part.text : "")).join(TEXT_JOIN_SEPARATOR);
    }
    return parts;
  }

  if (hasTool && !hasToolResults) {
    return items
      .filter((item): item is LangMessageItemTool => item.type === "tool")
      .map((item) => ({
        callId: item.callId,
        name: item.name,
        arguments: item.arguments ?? {},
      }));
  }

  if (hasToolResults) {
    return items
      .filter((item): item is LangMessageItemToolResult => item.type === "tool-result")
      .map((item) => ({
        toolId: item.callId,
        callId: item.callId,
        name: item.name,
        result: item.result,
      }));
  }

  return "";
}

export class LangMessage {
  role: LangMessageRole;
  items: LangMessageItem[];
  meta?: Record<string, any>;

  constructor(
    role: LangMessageRole,
    init?: string | LangMessageItem[] | LangMessageContent,
    meta?: Record<string, any>
  ) {
    this.role = role;
    this.items = toItems(init);
    this.meta = meta;
  }

  get content(): LangMessageContent {
    return itemsToLegacyContent(this.items);
  }

  set content(value: LangMessageContent | LangMessageItem[]) {
    this.items = toItems(value);
  }

  get text(): string {
    return this.items
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join(TEXT_JOIN_SEPARATOR);
  }

  get object(): any | null {
    const text = this.text;
    if (text && text.length > 0) return extractJSON(text);
    return null;
  }

  get toolRequests(): LangMessageItemTool[] {
    return this.items.filter(item => item.type === "tool").map(item => item as LangMessageItemTool);
  }

  get toolResults(): LangMessageItemToolResult[] {
    return this.items.filter(item => item.type === "tool-result").map(item => item as LangMessageItemToolResult);
  }

  get images(): LangMessageItemImage[] {
    return this.items.filter(item => item.type === "image").map(item => item as LangMessageItemImage);
  }

  appendText(text: string): LangMessageItemText | undefined {
    if (typeof text !== "string" || text.length === 0) return undefined;
    const last = this.items.length > 0 ? this.items[this.items.length - 1] : undefined;
    if (last && last.type === "text") {
      last.text += text;
      return last;
    }
    const newItem = createTextItem(text);
    this.items.push(newItem);
    return newItem;
  }

  appendThinking(text: string): LangMessageItemThinking | undefined {
    if (typeof text !== "string" || text.length === 0) return undefined;
    const last = this.items.length > 0 ? this.items[this.items.length - 1] : undefined;
    if (last && last.type === "thinking") {
      last.text += text;
      return last;
    }
    const newItem = createThinkingItem(text);
    this.items.push(newItem);
    return newItem;
  }

  addImage(image: LangContentImage | LangImageOutput | LangMessageItemImage): LangMessageItemImage {
    const item = mapImageInputToItem(image);
    // Merge consecutive images to keep metadata grouped if needed
    this.items.push(item);
    return item;
  }

  upsertToolCall(call: { callId: string; name?: string; arguments?: Record<string, any> }): LangMessageItemTool {
    const id = call.callId;
    let existing = this.items.find((item): item is LangMessageItemTool => item.type === "tool" && item.callId === id);
    if (!existing) {
      existing = createToolCallItem(id, call.name ?? "", call.arguments ?? {});
      this.items.push(existing);
    } else {
      if (typeof call.name === "string" && call.name.length > 0) {
        existing.name = call.name;
      }
      if (call.arguments !== undefined) {
        existing.arguments = call.arguments;
      }
    }
    return existing;
  }

  setToolCallArguments(callId: string, args: Record<string, any>): LangMessageItemTool | undefined {
    const tool = this.items.find((item): item is LangMessageItemTool => item.type === "tool" && item.callId === callId);
    if (tool) {
      tool.arguments = args;
    }
    return tool;
  }
}

export class LangMessages extends Array<LangMessage> {
  availableTools?: LangTool[];
  finished: boolean = false;
  instructions?: string;

  constructor();
  constructor(initialPrompt: string, opts?: { tools?: LangTool[] });
  constructor(initialMessages: LangMessage[], opts?: { tools?: LangTool[] });
  constructor(initialMessages: LangMessages, opts?: { tools?: LangTool[] });
  constructor(initialMessages: { role: LangMessageRole; items?: LangMessageItem[]; content?: LangMessageContent; meta?: Record<string, any> }[], opts?: { tools?: LangTool[] });
  constructor(
    initial?: string | { role: LangMessageRole; items?: LangMessageItem[]; content?: LangMessageContent; meta?: Record<string, any> }[] | LangMessage[] | LangMessages,
    opts?: { tools?: LangTool[] }
  ) {
    super();
    if (typeof initial === "string") {
      this.addUserMessage(initial);
    } else if (initial instanceof LangMessages) {
      for (const m of initial) {
        this.push(m);
      }
      if (opts?.tools) {
        this.availableTools = opts.tools;
      } else if (initial.availableTools) {
        // Share the same tools array reference intentionally
        this.availableTools = initial.availableTools;
      }
    } else if (Array.isArray(initial)) {
      for (const m of initial) {
        if (m instanceof LangMessage) {
          this.push(m);
        } else if (m && typeof m === "object") {
          const items = m.items ?? toItems(m.content);
          this.push(new LangMessage(m.role, items, m.meta));
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

  addUserMessage(content: string, meta?: Record<string, any>): this {
    this.push(new LangMessage("user", content, meta));
    return this;
  }

  addUserItems(items: LangMessageItem[] | LangMessageContent, meta?: Record<string, any>): this {
    this.push(new LangMessage("user", items as any, meta));
    return this;
  }

  addUserImage(image: LangContentImage | LangImageOutput | LangMessageItemImage, meta?: Record<string, any>): this {
    const message = new LangMessage("user", [], meta);
    message.addImage(image);
    this.push(message);
    return this;
  }

  addAssistantMessage(content: string, meta?: Record<string, any>): this {
    this.push(new LangMessage("assistant", content, meta));
    return this;
  }

  addAssistantItems(items: LangMessageItem[] | LangMessageContent, meta?: Record<string, any>): this {
    const message = this.ensureAssistantMessage(meta);
    const normalized = toItems(items as any);
    message.items.push(...normalized);
    return this;
  }

  appendToAssistantText(text: string, meta?: Record<string, any>): LangMessage {
    const message = this.ensureAssistantMessage(meta);
    message.appendText(text);
    return message;
  }

  appendToAssistantThinking(text: string, meta?: Record<string, any>): LangMessage | null {
    if (!text) return null;
    const message = this.ensureAssistantMessage(meta);
    message.appendThinking(text);
    return message;
  }

  addAssistantImage(image: LangContentImage | LangImageOutput | LangMessageItemImage, meta?: Record<string, any>): LangMessage {
    const message = this.ensureAssistantMessage(meta);
    message.addImage(image);
    return message;
  }

  ensureAssistantTextMessage(meta?: Record<string, any>): LangMessage {
    const message = this.ensureAssistantMessage(meta);
    let textItem = message.items.find(item => item.type === "text") as LangMessageItemText | undefined;
    if (!textItem) {
      textItem = createTextItem("");
      message.items.push(textItem);
    }
    return message;
  }

  addAssistantToolCalls(toolCalls: ToolRequest[], meta?: Record<string, any>): LangMessage {
    const message = this.ensureAssistantMessage(meta);
    for (const call of toolCalls) {
      const callId = String((call as any).callId ?? (call as any).id ?? "");
      message.upsertToolCall({
        callId,
        name: call.name ?? "",
        arguments: call.arguments ?? {},
      });
    }
    return message;
  }

  private ensureAssistantMessage(meta?: Record<string, any>): LangMessage {
    const last = this.length > 0 ? this[this.length - 1] : undefined;
    if (last && last.role === "assistant") {
      if (meta?.openaiResponseId && last.meta?.openaiResponseId && last.meta.openaiResponseId !== meta.openaiResponseId) {
        const msg = new LangMessage("assistant", [], meta);
        this.push(msg);
        return msg;
      }
      if (meta?.openaiResponseId && !last.meta?.openaiResponseId) {
        last.meta = { ...(last.meta || {}), openaiResponseId: meta.openaiResponseId };
        return last;
      }
      if (meta) {
        last.meta = { ...(last.meta || {}), ...meta };
      }
      return last;
    }
    const msg = new LangMessage("assistant", [], meta);
    this.push(msg);
    return msg;
  }

  async executeRequestedTools(meta?: Record<string, any>): Promise<LangMessage | null> {
    // Only execute if the very last message is an assistant message that has tool in its items
    const last = this.length > 0 ? this[this.length - 1] : undefined;
    if (!last || last.role !== "assistant" || last.items.length === 0) {
      return null;
    }

    const toolRequests = last.toolRequests;

    // Warn the user if we don't have any available tools
    if (!this.availableTools) {
      for (const toolRequest of toolRequests) {
        console.warn("Don't have available tool named '" + toolRequest.name + "'");
      }
      return null;
    }

    const toolsWithHandlers = (this.availableTools || []).filter(
      (t): t is LangToolWithHandler => 'handler' in t
    );

    // Execute requested tools from the last message only
    const toolResults: ToolResult[] = [];
    for (const requestedTool of toolRequests) {
      const toolName = requestedTool.name as string | undefined;
      if (!toolName) continue;

      const tool = toolsWithHandlers.find(t => t.name === toolName);
      if (!tool) continue;

      let result: any;
      try {
        result = await Promise.resolve(tool.handler(requestedTool.arguments || {}));
      } catch (error) {
        console.error('Error executing tool "' + toolName + '":', error);
        result = {
          error: true,
          name: error.name,
          message: error.message,
          ...Object.fromEntries(Object.entries(error)),
        }
      }

      const id = requestedTool.callId;
      toolResults.push({ toolId: id, name: toolName, result });
    }

    // Create a new user message with the tool results
    this.addUserItems(toolResults.map(result => ({ type: "tool-result", name: result.name, callId: result.toolId, result: result.result })));

    // We return the tool results message we've just added
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
