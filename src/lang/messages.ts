/**
 * Interface for tool requests that can be sent to language models
 */
export interface ToolRequest {
  callId: string;
  name: string;
  arguments: Record<string, any>;
}

// @TODO: not sure I need this, let's explore message types
/**
 * Interface for tool execution results
 */
export interface ToolResult {
  toolId: string;
  result: any;
}

export interface LangMessage {
  role: "user" | "assistant" | "tool" | "tool-results" | "system";
  content: string | LangContentPart[] | ToolRequest[] | ToolResult[];
  meta?: Record<string, any>;
}

export type LangImageInput =
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
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

export type LangContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: LangImageInput; alt?: string };


export type ToolWithHandler = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: Record<string, any>) => any | Promise<any>;
}

export class LangMessages extends Array<LangMessage> {
  availableTools?: ToolWithHandler[];

  // @TODO: add instructions that will be automatically added to the start of the messages 
  // as "system" message or "instructions" in the openai responses

  // Merged result fields
  answer: string = "";
  object: any | null = null;
  // Requested tool calls from the provider (normalized)
  tools?: Array<{ id: string; name: string; arguments: Record<string, any> }>;
  finished: boolean = false;
  thinking?: string;
  validationErrors: string[] = [];
  images?: LangImageOutput[];

  constructor();
  constructor(initialPrompt: string, opts?: { tools?: ToolWithHandler[] });
  constructor(initialMessages: LangMessage[], opts?: { tools?: ToolWithHandler[] });
  constructor(
    initial?: string | LangMessage[],
    opts?: { tools?: ToolWithHandler[] }
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

  get toolsRequested(): ToolRequest[] {
    // Get the last message with role "tool"

    if (this.length === 0) {
      return [];
    }

    const lastMessage = this[this.length - 1];
    if (lastMessage.role !== "tool") {
      return [];
    }

    return lastMessage.content as ToolRequest[];
  }

  addUserMessage(content: string): this {
    this.push({ role: "user", content });
    return this;
  }

  addUserContent(parts: LangContentPart[]): this {
    this.push({ role: "user", content: parts });
    return this;
  }

  addUserImage(image: LangImageInput, alt?: string): this {
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

  async executeRequestedTools(meta?: Record<string, any>): Promise<this> {
    if (this.toolsRequested.length === 0) {
      return this;
    }

    if (!this.availableTools) {
      console.warn("Requested tool names:", this.toolsRequested.map(t => t.name));
      return this;
    }

    // Execute requested tools
    const toolResults: ToolResult[] = [];
    const toolsByName = new Map<string, ToolWithHandler>(
      (this.availableTools || []).map((t) => [t.name, t])
    );
    for (const call of this.toolsRequested) {
      const toolName = call.name as string | undefined;
      if (!toolName || !toolsByName.has(toolName)) continue;
      const outcome = await Promise.resolve(toolsByName.get(toolName)!.handler(call.arguments || {}));
      const id = call.callId;
      toolResults.push({ toolId: id, result: outcome });
    }

    // Append execution results
    this.addToolUseMessage(toolResults, meta);

    return this;
  }

  toString(): string {
    // @TODO: should we output the messages?
    return this.answer;
  }
}


