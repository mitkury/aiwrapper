import type { 
  ToolRequest, 
  ToolResult 
} from "./language-provider.ts";

export interface LangChatMessage {
  role: "user" | "assistant" | "tool" | "tool-results" | "system";
  content: string | LangContentPart[] | any;
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

export class LangChatMessageCollection extends Array<LangChatMessage> {
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

  addAssistantMessage(content: string): this {
    this.push({ role: "assistant", content });
    return this;
  }

  addAssistantContent(parts: LangContentPart[]): this {
    this.push({ role: "assistant", content: parts });
    return this;
  }

  addAssistantToolCalls(toolCalls: ToolRequest[]): this {
    this.push({ role: "tool", content: toolCalls });
    return this;
  }

  addToolUseMessage(toolResults: any): this {
    this.push({ role: "tool-results", content: toolResults });
    return this;
  }

  addSystemMessage(content: string): this {
    this.push({ role: "system", content });
    return this;
  }
}

export type ToolWithHandler = {
  description?: string;
  parameters: Record<string, any>;
  handler: (args: any) => any | Promise<any>;
};

export type ToolsRegistry = Record<string, ToolWithHandler>;

export class LangMessages extends LangChatMessageCollection {
  tools?: ToolsRegistry;

  // Merged result fields
  answer: string = "";
  object: any | null = null;
  toolsRequested: ToolRequest[] | null = null; // internal alias; expose via getter
  finished: boolean = false;
  thinking?: string;
  validationErrors: string[] = [];
  images?: LangImageOutput[];

  constructor();
  constructor(initialPrompt: string, opts?: { tools?: ToolsRegistry });
  constructor(initialMessages: LangChatMessage[], opts?: { tools?: ToolsRegistry });
  constructor(
    initial?: string | LangChatMessage[],
    opts?: { tools?: ToolsRegistry }
  ) {
    // When extending Array, call super with the initial elements if provided
    super(...(Array.isArray(initial) ? (initial as LangChatMessage[]) : []));
    if (typeof initial === "string") {
      this.addUserMessage(initial);
    }
    if (opts?.tools) {
      this.tools = opts.tools;
    }
  }

  // Back-compat getters/setters
  get toolsCalls(): ToolRequest[] | null { return this.toolsRequested; }
  set toolsCalls(v: ToolRequest[] | null) { this.toolsRequested = v; }

  get requestedToolUse(): ToolRequest[] | null {
    return this.toolsRequested ?? null;
  }

  async executeRequestedTools(): Promise<this> {
    const requested = this.toolsRequested || [];
    if (!requested.length) {
      return this;
    }

    if (!this.tools) {
      return this;
    }

    // Record requested tool calls
    // @TODO: add tool name and args
    this.addAssistantToolCalls(requested);

    // Execute requested tools
    const toolResults: ToolResult[] = [];
    for (const call of requested) {
      const toolName = (call as any).name as string | undefined;
      if (!toolName || !(toolName in this.tools)) continue;
      const outcome = await Promise.resolve(this.tools[toolName].handler(call.arguments || {}));
      toolResults.push({ toolId: call.id, result: outcome });
    }

    // Append execution results
    this.addToolUseMessage(toolResults);

    return this;
  }

  toString(): string {
    return this.answer;
  }
}


