import extractJSON from "./json/extract-json";

export type LangMessageRole = "user" | "assistant" | "tool-results"  /*| "tool" | "tool-results" | "system"*/;
export type LangMessageContent = string | LangContentPart[] | ToolRequest[] | ToolResult[];
export type LangMessageMeta = Record<string, any>;
//export type LangMessageMetaValue = string | number | boolean | null | LangMessageMetaValue[];

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
  | LangMessageItemReasoning
  | LangMessageItemImage
  | LangMessageItemTool
  | LangMessageItemToolResult;

export type LangMessageItemText = {
  type: "text";
  text: string;
}

export type LangMessageItemReasoning = {
  type: "reasoning";
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

export type LangMessageItemTool = {
  type: "tool";
  name: string;
  callId: string;
  arguments: Record<string, any>;
}

export type LangMessageItemToolResult = {
  type: "tool-result"; // @TODO: consider to remove it
  name: string;
  callId: string;
  result: any;
}

export class LangMessage {
  role: LangMessageRole;
  items: LangMessageItem[];
  meta?: Record<string, any>;

  constructor(role: LangMessageRole, text: string, meta?: Record<string, any>);
  constructor(role: LangMessageRole, items: LangMessageItem[], meta?: Record<string, any>);
  constructor(
    role: "user" | "assistant",
    init: string | LangMessageItem[],
    meta?: Record<string, any>
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
    return this.items.filter(item => item.type === "tool").map(item => item as LangMessageItemTool);
  }

  get toolResults(): LangMessageItemToolResult[] {
    return this.items.filter(item => item.type === "tool-result").map(item => item as LangMessageItemToolResult);
  }

  get images(): LangMessageItemImage[] {
    return this.items.filter(item => item.type === "image").map(item => item as LangMessageItemImage);
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
  constructor(initialMessages: { role: LangMessageRole; items: LangMessageItem[]; }[], opts?: { tools?: LangTool[] });
  constructor(
    initial?: string | { role: LangMessageRole; items: LangMessageItem[]; }[] | LangMessage[] | LangMessages,
    opts?: { tools?: LangTool[] }
  ) {
    // When extending Array, call super with the initial elements if provided
    super(...(Array.isArray(initial) ? [] : []));
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
        } else {
          this.push(new LangMessage(m.role, m.items));
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
          base64: LangMessages.encodeBytesAsBase64(image.bytes),
          mimeType: image.mimeType
        };
      case "blob":
        throw new Error("LangMessages.addUserImages does not support Blob inputs yet. Convert the Blob to base64 or a URL first.");
      default:
        throw new Error("Unsupported image input type.");
    }
  }

  private static encodeBytesAsBase64(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    const globalObject: any = typeof globalThis !== "undefined" ? globalThis : {};

    if (globalObject.Buffer) {
      return globalObject.Buffer.from(view).toString("base64");
    }

    const btoaFn: ((data: string) => string) | undefined = typeof globalObject.btoa === "function" ? globalObject.btoa.bind(globalObject) : undefined;

    if (btoaFn) {
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < view.length; i += chunkSize) {
        const chunk = view.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      return btoaFn(binary);
    }

    throw new Error("Unable to convert byte images to base64 in this environment. Provide base64 or URL images instead.");
  }

  addAssistantMessage(content: string, meta?: Record<string, any>): this {
    this.push(new LangMessage("assistant", content, meta));
    return this;
  }

  addAssistantItems(items: LangMessageItem[], meta?: Record<string, any>): this {
    this.push(new LangMessage("assistant", items, meta));
    return this;
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
      if (!tool) {
        // Tool was requested but not found - add error result so LLM can respond
        const id = requestedTool.callId;
        toolResults.push({
          toolId: id,
          name: toolName,
          result: {
            error: true,
            name: "ToolNotFound",
            message: `Tool "${toolName}" is not available. Available tools: ${toolsWithHandlers.map(t => t.name).join(", ") || "none"}`,
          }
        });
        continue;
      }

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

    if (toolResults.length > 0) {
      // Create a new message with the tool results
      this.addToolResultsMessage(toolResults.map(result => ({ type: "tool-result", name: result.name, callId: result.toolId, result: result.result })));
    }

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
