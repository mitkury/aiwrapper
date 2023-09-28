import type { Tokenizer } from '../../tokens/tokenizer.ts';
import { getTokenizerBasedOnModel, LangModelNames } from '../../info.ts';
import { LangResult, LanguageModel } from '../lang.ts';
import { httpRequest as fetch } from '../../httpRequest.ts';
import { processResponseStream } from '../../processResponseStream.ts';
import { Lang } from '../index.ts';

export type OpenAILangOptions = {
  apiKey: string;
  model?: LangModelNames;
  systemPrompt?: string;
  customCalcCost?: (inTokens: number, outTokens: number) => string;
}

export type OpenAILangConfig = {
  apiKey: string;
  name: LangModelNames;
  systemPrompt: string;
  calcCost: (inTokens: number, outTokens: number) => string;
};

export class OpenAILang implements LanguageModel {
  readonly name: string;
  _config: OpenAILangConfig;
  _tokenizer: Tokenizer;

  constructor(options: OpenAILangOptions) {
    this._config = this._getConfig(options);
    this.name = this._config.name;
    this._tokenizer = getTokenizerBasedOnModel(this._config.name);
  }

  _getConfig(options: OpenAILangOptions): OpenAILangConfig {
    return {
      apiKey: options.apiKey,
      name: options.model || "gpt-4",
      systemPrompt: options.systemPrompt || `You are a helpful assistant.`,
      calcCost: options.customCalcCost || this._defaultCalcCost,
    };
  }

  async askForObject(typeSample: object, prompt: string): Promise<object> {
    throw new Error("Method not implemented.");
  }

  async ask(prompt: string, onResult: (result: LangResult) => void): Promise<string> {
    const result: LangResult = {
      answer: "",
      totalTokens: 0,
      promptTokens: this._tokenizer.encode(this._config.systemPrompt).length + this._tokenizer.encode(prompt).length,
      totalPrice: "0",
      finished: false,
    };

    const tokensInSystemPrompt = this._tokenizer.encode(this._config.systemPrompt).length;
    const tokensInPrompt = this._tokenizer.encode(prompt).length;

    const onData = (data) => {
      if (data.finished) {
        result.finished = true;
        onResult?.(result);
        return;
      }

      if (data.choices !== undefined) {
        const deltaContent = data.choices[0].delta.content
          ? data.choices[0].delta.content
          : "";

        result.answer += deltaContent;
        result.totalTokens = tokensInSystemPrompt + tokensInPrompt + this._tokenizer.encode(result.answer).length;
        // We do it from the config because users may want to set their own price calculation function.
        result.totalPrice = this._config.calcCost(tokensInSystemPrompt + tokensInPrompt, this._tokenizer.encode(result.answer).length);

        onResult?.(result);
      }
    }

    // @TODO: add re-tries with exponential backoff

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._config.apiKey}`,
      },
      body: JSON.stringify({
        model: this._config.name,
        messages: [
          {
            role: "system",
            content: this._config.systemPrompt,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        stream: true,
      }),
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);

    return result.answer;
  }

  _defaultCalcCost = (inTokens: number, outTokens: number): string => {
    return Lang.calcLangCost(this.name, inTokens, outTokens);
  }
}