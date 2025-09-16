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
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: Record<string, any>) => any | Promise<any>;
}

export class LangMessages extends LangChatMessageCollection {
  availableTools?: ToolWithHandler[];

  // Merged result fields
  answer: string = "";
  object: any | null = null;
  toolsRequested: ToolRequest[] | null = null; // deprecated internal alias
  // Requested tool calls from the provider (normalized)
  tools?: Array<{ id: string; name: string; arguments: Record<string, any> }>;
  finished: boolean = false;
  thinking?: string;
  validationErrors: string[] = [];
  images?: LangImageOutput[];

  constructor();
  constructor(initialPrompt: string, opts?: { tools?: ToolWithHandler[] });
  constructor(initialMessages: LangChatMessage[], opts?: { tools?: ToolWithHandler[] });
  constructor(
    initial?: string | LangChatMessage[],
    opts?: { tools?: ToolWithHandler[] }
  ) {
    // When extending Array, call super with the initial elements if provided
    super(...(Array.isArray(initial) ? (initial as LangChatMessage[]) : []));
    if (typeof initial === "string") {
      this.addUserMessage(initial);
    }
    if (opts?.tools) {
      this.availableTools = opts.tools;
    }
  }

  get requestedToolUse(): ToolRequest[] | null {
    return this.toolsRequested ?? null;
  }

  async executeRequestedTools(): Promise<this> {
    // @TODO: no, add this automatically right after we get the response with tools
    const requestedTools = (this.tools && this.tools.length > 0)
      ? this.tools
      : (this.toolsRequested as any) || [];
    if (!requestedTools.length) {
      return this;
    }

    if (!this.availableTools) {
      return this;
    }

    this.addAssistantToolCalls(requestedTools);

    // Execute requested tools
    const toolResults: ToolResult[] = [];
    const toolsByName = new Map<string, ToolWithHandler>(
      (this.availableTools || []).map((t) => [t.name, t])
    );
    for (const call of requestedTools) {
      const toolName = (call as any).name as string | undefined;
      if (!toolName || !toolsByName.has(toolName)) continue;
      const outcome = await Promise.resolve(toolsByName.get(toolName)!.handler((call as any).arguments || {}));
      const id = (call as any).id || (call as any).callId;
      toolResults.push({ toolId: id, result: outcome });
    }

    // Append execution results
    this.addToolUseMessage(toolResults);

    return this;
  }

  toString(): string {
    return this.answer;
  }
}


