import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import {
  LangMessageCollection,
  LangResultWithMessages,
  LangResultWithString,
  LanguageProvider,
} from "../language-provider.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type CohereLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class CohereLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _maxTokens?: number;
  private modelInfo?: Model;

  constructor(options: CohereLangOptions) {
    const modelName = options.model || "command-r-plus-08-2024";
    super(modelName);

    // Get model info from aimodels
    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Cohere model: ${modelName}. Model not found in aimodels database.`);
    }

    this.modelInfo = modelInfo;
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
    this._maxTokens = options.maxTokens;
  }

  async ask(
    prompt: string,
    onResult?: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString> {
    const messages: LangMessageCollection = [];

    if (this._systemPrompt) {
      messages.push({
        role: "system",
        content: this._systemPrompt,
      });
    }

    messages.push({
      role: "user",
      content: prompt,
    });

    return await this.chat(messages, onResult);
  }

  async chat(
    messages: LangMessageCollection,
    onResult?: (result: LangResultWithMessages) => void,
  ): Promise<LangResultWithMessages> {
    const result = new LangResultWithMessages(messages);

    // Transform messages to Cohere's format (only user/assistant roles)
    const transformedMessages = messages.map(msg => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content
    }));

    // Calculate max tokens if we have model info
    let maxTokens = this._maxTokens;
    if (this.modelInfo && !maxTokens) {
      maxTokens = calculateModelResponseTokens(
        this.modelInfo,
        messages,
        this._maxTokens
      );
    }

    const requestBody = {
      messages: transformedMessages,
      model: this._model,
      stream: true,
      max_tokens: maxTokens,
      temperature: 0.7,
      preamble_override: this._systemPrompt || undefined,
    };

    const response = await fetch(`https://api.cohere.com/v2/chat?alt=sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
        "Accept": "text/event-stream",
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

        if (res.status === 400 || res.status === 422) {
          const data = await res.text();
          decision.retry = false;
          throw new Error(data);
        }

        return decision;
      },
    }).catch((err) => {
      throw new Error(err);
    });

    const onData = (data: any) => {
      if (data.type === "message-end") {
        result.finished = true;
        onResult?.(result);
        return;
      }

      // Handle Cohere's streaming format
      if (data.type === "content-delta" && data.delta?.message?.content?.text) {
        const text = data.delta.message.content.text;
        result.answer += text;

        result.messages = [...messages, {
          role: "assistant",
          content: result.answer,
        }];

        onResult?.(result);
      }
    };

    await processResponseStream(response, onData);

    return result;
  }
} 