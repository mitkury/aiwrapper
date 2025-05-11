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
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-4o";
    
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.openai.com/v1",
    });
    
    // For OpenAI, we require the model to be in aimodels database
    if (!this.modelInfo) {
      console.error(`Invalid OpenAI model: ${modelName}. Model not found in aimodels database.`);
    }
  }

  override async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult> {
    // Ensure we have a LangChatMessageCollection
    let messageCollection: LangChatMessageCollection;
    if (messages instanceof LangChatMessageCollection) {
      messageCollection = messages;
    } else {
      messageCollection = new LangChatMessageCollection(...messages);
    }
    
    // Initialize result
    const result = new LangResult(messageCollection);
    
    // Transform OpenAI-specific message roles
    const transformedMessages = messages.map((message) => {
      const msg = { ...message };
      // Cast to any to handle the system role which isn't in the LangChatMessage type
      const roleAny = (msg as any).role;
      
      if (roleAny === "system" && this._config.model.includes("o1")) {
        return { ...msg, role: "user" as const };
      }
      else if (roleAny === "system") {
        return { ...msg, role: "developer" as any };
      }
      return msg;
    });
    
    // Continue with regular chat processing
    const onResult = options?.onResult;
    
    // Calculate max tokens
    const requestMaxTokens = this.modelInfo 
      ? calculateModelResponseTokens(
          this.modelInfo,
          transformedMessages as any,
          this._config.maxTokens
        )
      : this._config.maxTokens || 4000;
      
    // For reasoning models, ensure there's enough space
    if (this.supportsReasoning() && this._config.maxCompletionTokens === undefined) {
      this._config.maxCompletionTokens = Math.max(requestMaxTokens, 25000);
    }

    const onData = (data: any) => {
      this.handleStreamData(data, result, messageCollection, onResult);
    };
    
    // Create request body
    const body = this.transformBody({
      model: this._config.model,
      messages: transformedMessages,
      stream: true,
      max_tokens: requestMaxTokens,
      ...this._config.bodyProperties,
    });

    const response = await fetch(`${this._config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this._config.apiKey ? { "Authorization": `Bearer ${this._config.apiKey}` } : {}),
        ...this._config.headers,
      },
      body: JSON.stringify(body),
      onNotOkResponse: async (
        res: Response,
        decision: DecisionOnNotOkResponse
      ): Promise<DecisionOnNotOkResponse> => {
        if (res.status === 401) {
          decision.retry = false;
          throw new Error("Authentication failed. Please check your credentials and try again.");
        }

        if (res.status === 400) {
          const data = await res.text();
          decision.retry = false;
          throw new Error(data);
        }

        return decision;
      },
    }).catch((err) => {
      throw new Error(err);
    });

    await processResponseStream(response, onData);

    return result;
  }

  protected override transformBody(body: Record<string, unknown>): Record<string, unknown> {
    // Apply parent transformations first
    let transformedBody = super.transformBody(body);
    
    // OpenAI now uses max_completion_tokens instead of max_tokens
    if (transformedBody.max_tokens) {
      const { max_tokens, ...rest } = transformedBody;
      return {
        ...rest,
        max_completion_tokens: max_tokens
      };
    }
    
    return transformedBody;
  }
  
  /**
   * Override handleStreamData to properly handle OpenAI-specific 
   * response format for tool calls
   */
  protected override handleStreamData(
    data: any, 
    result: LangResult,
    messages: LangChatMessageCollection,
    onResult?: (result: LangResult) => void
  ): void {
    // Use the parent implementation for now
    // This can be customized later for OpenAI-specific handling
    super.handleStreamData(data, result, messages, onResult);
  }
  
  /**
   * Override formatTools to format tools according to OpenAI's API requirements
   */
  protected override formatTools(tools: Tool[]): any[] {
    // Use the parent implementation for now
    return super.formatTools(tools);
  }
}
