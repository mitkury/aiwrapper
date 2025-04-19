import {
  LangChatMessages,
  LangResultWithMessages,
  LangResultWithString,
  LanguageProvider,
} from "../language-provider.ts";
import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

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
    onResult?: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString> {
    const messages: LangChatMessages = [];

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
    messages: LangChatMessages,
    onResult?: (result: LangResultWithMessages) => void,
  ): Promise<LangResultWithMessages> {
    const result = new LangResultWithMessages(messages);

    // Transform messages into Google's format
    const contents = messages.map(msg => {
      if (msg.role === "system") {
        // For system messages, we'll send them as user messages with a clear prefix
        return {
          role: "user",
          parts: [{ text: `System instruction: ${msg.content}` }]
        };
      }
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      };
    });

    // Calculate max tokens if we have model info
    let maxOutputTokens = this._maxTokens;
    if (this.modelInfo && !maxOutputTokens) {
      maxOutputTokens = calculateModelResponseTokens(
        this.modelInfo,
        messages,
        this._maxTokens
      );
    }

    const requestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
      }
    };

    const onData = (data: any) => {
      if (data.finished) {
        result.finished = true;
        onResult?.(result);
        return;
      }

      // Handle Google's streaming format
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const text = data.candidates[0].content.parts[0].text;
        result.answer += text;

        result.messages = [...messages, {
          role: "assistant",
          content: result.answer,
        }];

        onResult?.(result);
      }
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
} 