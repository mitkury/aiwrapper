import {
  LangChatMessageCollection,
  LangOptions,
  LangResult,
  LangChatMessage,
  Tool
} from "../language-provider.ts";
import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { 
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch
} from "../../http-request.ts";
import { OpenAIResponsesLang } from "./openai-responses-lang.ts";
import { LangImageInput } from "../language-provider.ts";

export type OpenAILangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export type OpenAILangConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
};

export type OpenAIChatMessage = {
  role: "developer" | "user" | "assistant";
  content: string;
};

export class OpenAILang extends OpenAILikeLang {
  private _responses?: OpenAIResponsesLang;
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-4o";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.openai.com/v1",
    });
    
    if (!this.modelInfo) {
      console.error(`Invalid OpenAI model: ${modelName}. Model not found in aimodels database.`);
    }

    this._responses = new OpenAIResponsesLang({ apiKey: options.apiKey, model: modelName, systemPrompt: options.systemPrompt });
  }

  // Image generation/editing moved to Img API

  private isResponsesPreferred(model: string): boolean {
    return /^(gpt-4o|o1|o3|gpt-image-1)/i.test(model);
  }

  override async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult> {
    if (this._responses && this.isResponsesPreferred(this.name)) {
      try {
        return await this._responses.chat(messages, options);
      } catch (err: any) {
        if (String(err?.message || '').includes("Unsupported parameter") || String(err?.message || '').includes("invalid_request_error")) {
          return super.chat(messages as any, options);
        }
        throw err;
      }
    }
    return super.chat(messages as any, options);
  }

  protected override transformBody(body: Record<string, unknown>): Record<string, unknown> {
    const transformedBody = super.transformBody(body);
    if ((transformedBody as any).max_tokens) {
      const { max_tokens, ...rest } = transformedBody as any;
      return { ...rest, max_completion_tokens: max_tokens } as Record<string, unknown>;
    }
    return transformedBody;
  }
  
  protected override handleStreamData(
    data: any, 
    result: LangResult,
    messages: LangChatMessageCollection,
    onResult?: (result: LangResult) => void,
    toolArgBuffers?: Map<string, { name: string; buffer: string }>
  ): void {
    super.handleStreamData(data, result, messages, onResult, toolArgBuffers);
  }
  
  protected override formatTools(tools: Tool[]): any[] {
    return super.formatTools(tools);
  }
}
