import { LangChatMessages, LangResultWithMessages, LangResultWithString, LanguageProvider } from "../language-provider.ts";
import { httpRequestWithRetry as fetch } from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type OllamaLangOptions = {
  url?: string;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export type OllamaLangConfig = {
  url: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
};

export class OllamaLang extends LanguageProvider {
  _config: OllamaLangConfig;

  constructor(options: OllamaLangOptions) {
    const model = options.model;
    super(model);

    // Try to get model info from aimodels
    const modelInfo = models.id(model);

    this._config = {
      url: options.url || "http://localhost:11434",
      model,
      systemPrompt: options.systemPrompt ? options.systemPrompt : '',
      maxTokens: options.maxTokens,
    };

    // If we have model info, validate maxTokens against model's context
    if (modelInfo && this._config.maxTokens && modelInfo.context?.maxOutput) {
      this._config.maxTokens = Math.min(
        this._config.maxTokens,
        modelInfo.context.maxOutput
      );
    }
  }

  async ask(
    prompt: string,
    onResult?: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString> {
    const result = new LangResultWithString(prompt);

    // Try to get model info and calculate max tokens
    const modelInfo = models.id(this._config.model);
    let requestMaxTokens = this._config.maxTokens;

    if (modelInfo) {
      requestMaxTokens = calculateModelResponseTokens(
        modelInfo,
        [{ role: "user", content: prompt }],
        this._config.maxTokens
      );
    }

    const onData = (data: any) => {
      if (data.done) {
        result.finished = true;
        onResult?.(result);
        return;
      }

      if (data.response) {
        result.answer += data.response;
      }

      onResult?.(result);
    };

    const response = await fetch(`${this._config.url}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this._config.model,
        prompt,
        stream: true,
        ...(requestMaxTokens && { num_predict: requestMaxTokens })
      }),
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);

    return result;
  }

  async chat(messages: LangChatMessages, onResult?: (result: LangResultWithMessages) => void): Promise<LangResultWithMessages> {
    const result = new LangResultWithMessages(
      messages,
    );

    // Try to get model info and calculate max tokens
    const modelInfo = models.id(this._config.model);
    let requestMaxTokens = this._config.maxTokens;

    if (modelInfo) {
      requestMaxTokens = calculateModelResponseTokens(
        modelInfo,
        messages,
        this._config.maxTokens
      );
    }

    const onData = (data: any) => {
      if (data.done) {
        result.finished = true;
        onResult?.(result);
        return;
      }

      if (data.message && data.message.content) {
        result.answer += data.message.content;
      }

      onResult?.(result);
    };

    const response = await fetch(`${this._config.url}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: this._config.model,
        messages,
        stream: true,
        ...(requestMaxTokens && { num_predict: requestMaxTokens }),
      })
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);

    return result;
  }
}
