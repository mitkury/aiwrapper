import {
  LangChatMessageCollection,
  LangOptions,
  LangChatMessage,
  Tool
} from "../language-provider.ts";
import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { OpenAIResponsesLang } from "./openai-responses-lang.ts";
import { LangMessages } from "../messages.ts";

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

    // @TODO: move it out and have 2 separate classes OpenAILangOld and OpenAILang (responses)
    this._responses = new OpenAIResponsesLang({ apiKey: options.apiKey, model: modelName, systemPrompt: options.systemPrompt });
  }

  private shouldUseResponses(messages: LangChatMessage[] | LangChatMessageCollection): boolean {
    return false;
  }

  override async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangMessages> {
    if (this._responses && this.shouldUseResponses(messages)) {
      return this._responses.chat(messages as any, options) as any;
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
    result: LangMessages,
    messages: LangMessages,
    onResult?: (result: LangMessages) => void,
    toolArgBuffers?: Map<string, { name: string; buffer: string }>
  ): void {
    super.handleStreamData(data, result, messages, onResult, toolArgBuffers);
  }
  
  protected override formatTools(tools: Tool[]): any[] {
    return super.formatTools(tools);
  }
}
