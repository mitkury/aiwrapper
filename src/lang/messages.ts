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

export interface LangMessage {
  role: "user" | "assistant" | "tool" | "tool-results" | "system";
  content: string | LangContentPart[] | ToolRequest[] | ToolResult[];
  meta?: Record<string, any>;
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
  constructor(
    initial?: string | LangMessage[],
    opts?: { tools?: LangTool[] }
  ) {
    // When extending Array, call super with the initial elements if provided
    super(...(Array.isArray(initial) ? (initial as LangMessage[]) : []));
    if (typeof initial === "string") {
      this.addUserMessage(initial);
    }
    if (opts?.tools) {
      this.availableTools = opts.tools;
    }
  }

  get answer(): string {
    for (let i = this.length - 1; i >= 0; i--) {
      const msg = this[i];
      if (msg.role === "assistant") {
        const content: any = (msg as any).content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          let text = "";
          for (const part of content) {
            if (part && part.type === "text" && typeof part.text === "string") {
              text += part.text;
            }
          }
          return text;
        }
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
    const images: LangImageOutput[] = [];
    
    // Find the last message from the specified role
    for (let i = this.length - 1; i >= 0; i--) {
      const msg = this[i];
      if (msg.role === role && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if ((part as any).type === "image") {
            const imagePart = part as { type: "image"; image: LangContentImage; alt?: string };
            images.push({
              url: imagePart.image.kind === "url" ? imagePart.image.url : undefined,
              base64: imagePart.image.kind === "base64" ? imagePart.image.base64 : undefined,
              mimeType: (imagePart.image as any).mimeType,
              metadata: msg.meta?.imageGeneration
            });
          }
        }
        break; // Only process the last message from this role
      }
    }
    return images;
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
    const created: LangMessage = { role: "assistant", content: "" };
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
    const created: LangMessage = { role: "assistant", content: [] as LangContentPart[] };
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
    this.push({ role: "user", content });
    return this;
  }

  addUserContent(parts: LangContentPart[]): this {
    this.push({ role: "user", content: parts });
    return this;
  }

  addUserImage(image: LangContentImage, alt?: string): this {
    const parts: LangContentPart[] = [{ type: "image", image, alt }];
    return this.addUserContent(parts);
  }

  addAssistantMessage(content: string, meta?: Record<string, any>): this {
    this.push({ role: "assistant", content, meta });
    return this;
  }

  addAssistantContent(parts: LangContentPart[], meta?: Record<string, any>): this {
    this.push({ role: "assistant", content: parts, meta });
    return this;
  }

  addAssistantToolCalls(toolCalls: ToolRequest[], meta?: Record<string, any>): this {
    this.push({ role: "tool", content: toolCalls, meta });
    return this;
  }

  addToolUseMessage(toolResults: ToolResult[], meta?: Record<string, any>): this {
    this.push({ role: "tool-results", content: toolResults, meta });
    return this;
  }

  addSystemMessage(content: string, meta?: Record<string, any>): this {
    this.push({ role: "system", content, meta });
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


