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

export type LangMessageRole = "user" | "assistant" | "tool" | "tool-results" | "system";
export type LangMessageContent = string | LangContentPart[] | ToolRequest[] | ToolResult[];
export type LangMessageMeta = Record<string, any>;
//export type LangMessageMetaValue = string | number | boolean | null | LangMessageMetaValue[];

export class LangMessage {
  role: LangMessageRole;
  content: LangMessageContent;
  meta?: Record<string, any>;

  constructor(
    role: "user" | "assistant" | "tool" | "tool-results" | "system",
    content: LangMessageContent = "",
    meta?: Record<string, any>
  ) {
    this.role = role;
    this.content = content;
    this.meta = meta;
  }

  addText(text: string): this {
    if (typeof this.content === "string") {
      this.content = (this.content || "") + text;
      return this;
    }
    if (!Array.isArray(this.content)) this.content = [] as LangContentPart[];
    const parts = this.content as LangContentPart[];
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
    if (last && (last as any).type === "text") {
      (last as any).text += text;
    } else {
      parts.push({ type: "text", text });
    }
    return this;
  }

  addImage(image: LangContentImage, alt?: string): this {
    if (!Array.isArray(this.content)) this.content = [] as LangContentPart[];
    (this.content as LangContentPart[]).push({ type: "image", image, alt });
    return this;
  }

  addToolRequest(request: ToolRequest): this {
    this.role = "tool";
    if (!Array.isArray(this.content)) this.content = [] as ToolRequest[];
    (this.content as ToolRequest[]).push(request);
    return this;
  }

  addToolResult(result: ToolResult): this {
    this.role = "tool-results";
    if (!Array.isArray(this.content)) this.content = [] as ToolResult[];
    (this.content as ToolResult[]).push(result);
    return this;
  }

  /**
   * Extracts all relevant content types from the message in a structured way.
   * 
   * Returns an object containing:
   * - `text` (string): All text content, if present in the message.
   * - `toolRequests` (ToolRequest[]): All tool requests, if the role is "tool".
   * - `toolResults` (ToolResult[]): All tool results, if the role is "tool-results".
   * - `images` (LangImageOutput[]): All image attachments, if present.
   * 
   * This makes it easier to access different content forms (text, tools, images)
   * regardless of how the message was constructed.
   * 
   * Example usages:
   *   const extracted = msg.extractContent();
   *   if (extracted.text) { ... }
   *   if (extracted.toolRequests) { ... }
   *   if (extracted.images?.length) { ... }
   */
  extractContent(): ExtractedMessageContent {
    const out: ExtractedMessageContent = {};

    // Text-only content
    if (typeof this.content === "string") {
      out.text = this.content;
      return out;
    }

    // Tool-related roles take precedence
    if (this.role === "tool" && Array.isArray(this.content)) {
      out.toolRequests = this.content as ToolRequest[];
      return out;
    }
    if (this.role === "tool-results" && Array.isArray(this.content)) {
      out.toolResults = this.content as ToolResult[];
      return out;
    }

    // Mixed/parts content: extract text and images if present
    if (Array.isArray(this.content)) {
      const parts = this.content as LangContentPart[];

      const text = parts
        .filter(p => (p as any).type === "text")
        .map(p => (p as any).text as string)
        .join("\n\n");
      if (text) out.text = text;

      const images: LangImageOutput[] = [];
      for (const part of parts) {
        if ((part as any).type === "image") {
          const imagePart = part as { type: "image"; image: LangContentImage; alt?: string };
          images.push({
            url: imagePart.image.kind === "url" ? imagePart.image.url : undefined,
            base64: imagePart.image.kind === "base64" ? imagePart.image.base64 : undefined,
            mimeType: (imagePart.image as any).mimeType,
            metadata: this.meta?.imageGeneration
          });
        }
      }
      if (images.length > 0) out.images = images;
    }

    return out;

  }

  get text(): string {
    if (typeof this.content === "string") return this.content;
    if (this.role === "tool" && Array.isArray(this.content)) return "";
    if (this.role === "tool-results" && Array.isArray(this.content)) return "";
    if (Array.isArray(this.content)) {
      return (this.content as LangContentPart[])
        .filter(p => (p as any).type === "text")
        .map(p => (p as any).text as string)
        .join("\n\n");
    }
    return "";
  }
}

/** A type to simplify extracting content from a message */
export type ExtractedMessageContent = {
  text?: string;
  images?: LangImageOutput[];
  toolRequests?: ToolRequest[];
  toolResults?: ToolResult[];
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

export type LangContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: LangContentImage; alt?: string }
  | { type: "thinking"; text: string };

export type LangToolWithHandler = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: Record<string, any>) => any | Promise<any>;
}

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

export class LangMessages extends Array<LangMessage> {
  availableTools?: LangTool[];

  // Merged result fields
  object: any | null = null;
  finished: boolean = false;
  validationErrors: string[] = [];
  instructions?: string;

  constructor();
  constructor(initialPrompt: string, opts?: { tools?: LangTool[] });
  constructor(initialMessages: LangMessage[], opts?: { tools?: LangTool[] });
  constructor(initialMessages: { role: LangMessageRole; content: LangMessageContent; }[], opts?: { tools?: LangTool[] });
  constructor(
    initial?: string | { role: LangMessageRole; content: LangMessageContent; }[] | LangMessage[],
    opts?: { tools?: LangTool[] }
  ) {
    // When extending Array, call super with the initial elements if provided
    super(...(Array.isArray(initial) ? [] : []));
    if (typeof initial === "string") {
      this.addUserMessage(initial);
    } else if (Array.isArray(initial)) {
      for (const m of (initial as (LangMessage | { role: LangMessageRole; content: LangMessageContent; })[])) {
        if (m instanceof LangMessage) {
          this.push(m);
        } else {
          this.push(new LangMessage(m.role, m.content));
        }
      }
    }
    if (opts?.tools) {
      this.availableTools = opts.tools;
    }
  }

  get answer(): string {
    for (let i = this.length - 1; i >= 0; i--) {
      const msg = this[i];
      if (msg.role === "assistant") {
        const content = msg.extractContent();
        if (content.text) return content.text;
      }
    }
    return "";
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

    const content = lastMessageByRole.extractContent();
    if (content.images) return content.images;
    return [];
  }

  /**
   * Ensure there is an assistant message with string content at the end and return it
   */
  ensureAssistantTextMessage(): LangMessage {
    const last = this.length > 0 ? this[this.length - 1] : undefined;
    if (last && last.role === "assistant") {
      if (typeof last.content !== "string") (last as any).content = "";
      return last;
    }
    const created = new LangMessage("assistant", "");
    this.push(created);
    return created;
  }

  /**
   * Ensure there is an assistant message with array content at the end and return it
   */
  ensureAssistantPartsMessage(): LangMessage {
    const last = this.length > 0 ? this[this.length - 1] : undefined;
    if (last && last.role === "assistant") {
      if (Array.isArray(last.content)) return last;
      const parts: LangContentPart[] = [];
      if (typeof last.content === "string" && last.content.length > 0) {
        parts.push({ type: "text", text: last.content });
      }
      (last as any).content = parts;
      return last;
    }
    const created = new LangMessage("assistant", [] as LangContentPart[]);
    this.push(created);
    return created;
  }

  /**
   * Append text to the last assistant message (creating if needed)
   */
  appendToAssistantText(text: string): LangMessage {
    const msg = this.ensureAssistantTextMessage();
    (msg as any).content = String((msg as any).content || "") + text;
    return msg;
  }

  /**
   * Append or create a thinking content part in the last assistant message
   */
  appendToAssistantThinking(text: string): LangMessage {
    const msg = this.ensureAssistantPartsMessage();
    const parts = msg.content as LangContentPart[];
    const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
    if (lastPart && lastPart.type === "thinking") {
      lastPart.text += text;
    } else {
      parts.push({ type: "thinking", text });
    }
    return msg;
  }

  addAssistantContentPart(part: LangContentPart): this {
    const msg = this.ensureAssistantPartsMessage();
    (msg.content as LangContentPart[]).push(part);
    return this;
  }

  addAssistantImage(image: LangContentImage, alt?: string): this {
    return this.addAssistantContentPart({ type: "image", image, alt });
  }

  addUserMessage(content: string): this {
    this.push(new LangMessage("user", content));
    return this;
  }

  addUserContent(parts: LangContentPart[]): this {
    this.push(new LangMessage("user", parts));
    return this;
  }

  addUserImage(image: LangContentImage, alt?: string): this {
    const parts: LangContentPart[] = [{ type: "image", image, alt }];
    return this.addUserContent(parts);
  }

  addAssistantMessage(content: string, meta?: Record<string, any>): this {
    this.push(new LangMessage("assistant", content, meta));
    return this;
  }

  addAssistantContent(parts: LangContentPart[], meta?: Record<string, any>): this {
    this.push(new LangMessage("assistant", parts, meta));
    return this;
  }

  addAssistantToolCalls(toolCalls: ToolRequest[], meta?: Record<string, any>): this {
    this.push(new LangMessage("tool", toolCalls, meta));
    return this;
  }

  addToolUseMessage(toolResults: ToolResult[], meta?: Record<string, any>): this {
    this.push(new LangMessage("tool-results", toolResults, meta));
    return this;
  }

  addSystemMessage(content: string, meta?: Record<string, any>): this {
    this.push(new LangMessage("system", content, meta));
    return this;
  }

  async executeRequestedTools(meta?: Record<string, any>): Promise<LangMessage | null> {
    // Only execute if the very last message is a tool request
    const last = this.length > 0 ? this[this.length - 1] : undefined;
    if (!last || last.role !== "tool" || !Array.isArray(last.content) || last.content.length === 0) {
      return null;
    }

    if (!this.availableTools) {
      try {
        const names = (last.content as ToolRequest[]).map(t => t.name);
        console.warn("Requested tool names:", names);
      } catch { }
      return null;
    }

    const toolsWithHandlers = (this.availableTools || []).filter(
      (t): t is LangToolWithHandler => 'handler' in t
    );

    // Execute requested tools from the last message only
    const toolResults: ToolResult[] = [];
    for (const requestedTool of (last.content as ToolRequest[])) {
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

    // Append execution results
    this.addToolUseMessage(toolResults, meta);
    // We return the tool results message we've just added
    return this[this.length - 1];
  }

  toString(): string {
    const out: string[] = [];
    for (const msg of this) {
      out.push(`${msg.role}: ${JSON.stringify(msg.content)}`);
    }
    return out.join("\n\n");
  }
}


