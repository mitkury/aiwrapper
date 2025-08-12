import {
  LangChatMessageCollection,
  LangOptions, LangResult,
  
  LanguageProvider,
} from "../language-provider.ts";
import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { LangChatMessage, LangChatMessageCollection } from "../language-provider.ts";

export type GoogleLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class GoogleLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _maxTokens?: number;
  private modelInfo?: Model;

  constructor(options: GoogleLangOptions) {
    const modelName = options.model || "gemini-2.0-flash";
    super(modelName);

    // Get model info from aimodels
    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Google model: ${modelName}. Model not found in aimodels database.`);
    }

    this.modelInfo = modelInfo;
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
    this._maxTokens = options.maxTokens;
  }

  async ask(
    prompt: string,
    options?: LangOptions,
  ): Promise<LangResult> {
    const messages = new LangChatMessageCollection();

    if (this._systemPrompt) {
      messages.push({
        role: "user" as "user", // Cast to user role for system prompts
        content: this._systemPrompt,
      });
    }

    messages.push({
      role: "user",
      content: prompt,
    });

    return await this.chat(messages, options);
  }

  async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangResult> {
    const messageCollection = messages instanceof LangChatMessageCollection
      ? messages
      : new LangChatMessageCollection(...messages);
    const result = new LangResult(messageCollection);

    // Transform messages into Google's format
    const contents = this.transformMessagesForProvider(messageCollection);

    // Calculate max tokens if we have model info
    let maxOutputTokens = this._maxTokens;
    if (this.modelInfo && !maxOutputTokens) {
      maxOutputTokens = calculateModelResponseTokens(
        this.modelInfo,
        messageCollection,
        this._maxTokens
      );
    }

    // Map tools -> functionDeclarations
    let tools: any | undefined;
    if (options?.tools && options.tools.length > 0) {
      tools = {
        functionDeclarations: options.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      };
    }

    const requestBody: any = {
      contents,
      generationConfig: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
      },
      ...(tools ? { tools } : {}),
    };

    const onResult = options?.onResult;
    const onData = (data: any) => {
      if (data.finished) {
        result.finished = true;
        options?.onResult?.(result);
        return;
      }

      // Handle Google's streaming format: detect functionCall parts
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      for (const p of parts) {
        if (p.text) {
          result.answer += p.text;
        }
        if (p.functionCall) {
          if (!result.tools) result.tools = [];
          const { name, args } = p.functionCall;
          // Google often sends full args object; ensure shape
          result.tools.push({ id: name, name, arguments: args || {} } as any);
        }
      }

      if (result.answer) {
        result.addAssistantMessage(result.answer);
      }

      options?.onResult?.(result);
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:streamGenerateContent?alt=sse&key=${this._apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        onNotOkResponse: async (
          res,
          decision,
        ): Promise<DecisionOnNotOkResponse> => {
          if (res.status === 401) {
            decision.retry = false;
            throw new Error(
              "API key is invalid. Please check your API key and try again.",
            );
          }

          if (res.status === 400) {
            const data = await res.text();
            decision.retry = false;
            throw new Error(data);
          }

          return decision;
        },
      },
    ).catch((err) => {
      throw new Error(err);
    });

    await processResponseStream(response, onData);

    return result;
  }

  /**
   * Transform generic messages into Gemini format, mapping tool results
   */
  protected transformMessagesForProvider(messages: LangChatMessageCollection): any[] {
    return messages.map((msg: any) => {
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        // Emit as functionResponse parts in a user role
        return {
          role: 'user',
          parts: msg.content.map((tr: any) => ({
            functionResponse: {
              name: tr.toolId, // Use toolId (should be function name in Gemini responses)
              response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result }
            }
          }))
        };
      }
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      };
    });
  }
} 