import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import {
  LangChatMessages,
  LangResultWithMessages,
  LangResultWithString,
  LanguageProvider,
} from "../language-provider.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type AnthropicLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export type AnthropicLangConfig = {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class AnthropicLang extends LanguageProvider {
  _config: AnthropicLangConfig;

  constructor(options: AnthropicLangOptions) {
    const modelName = options.model || "claude-3-sonnet-20240229";
    super(modelName);

    // Get model info from aimodels
    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Anthropic model: ${modelName}. Model not found in aimodels database.`);
    }

    this._config = {
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt,
      maxTokens: options.maxTokens,
    };
  }

  async ask(
    prompt: string,
    onResult?: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString> {
    const messages: LangChatMessages = [];

    if (this._config.systemPrompt) {
      messages.push({
        role: "system",
        content: this._config.systemPrompt,
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
    
    // Remove all system messages, save the first one if it exists.
    let detectedSystemMessage = "";
    messages = messages.filter((message) => {
      if (message.role === "system") {
        if (!detectedSystemMessage) {
          // Saving the first system message.
          detectedSystemMessage = message.content;
        }
        return false;
      }
      return true;
    });

    const result = new LangResultWithMessages(messages);

    // Get model info and calculate max tokens
    const modelInfo = models.id(this._config.model);
    if (!modelInfo) {
      throw new Error(`Model info not found for ${this._config.model}`);
    }

    const requestMaxTokens = calculateModelResponseTokens(
      modelInfo,
      messages,
      this._config.maxTokens
    );

    const onData = (data: any) => {
      if (data.type === "message_stop") {
        result.finished = true;
        onResult?.(result);
        return;
      }

      if (
        data.type === "message_delta" && data.delta.stop_reason === "end_turn"
      ) {
        const choices = data.delta.choices;
        if (choices && choices.length > 0) {
          const deltaContent = choices[0].delta.content
            ? choices[0].delta.content
            : "";
          result.answer += deltaContent;
          result.messages = [
            ...messages,
            {
              role: "assistant",
              content: result.answer,
            },
          ];
          onResult?.(result);
        }
      }

      if (data.type === "content_block_delta") {
        const deltaContent = data.delta.text ? data.delta.text : "";
        result.answer += deltaContent;
        onResult?.(result);
      }
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-api-key": this._config.apiKey
      },
      body: JSON.stringify({
        model: this._config.model,
        messages: messages,
        max_tokens: requestMaxTokens,
        system: this._config.systemPrompt ? this._config.systemPrompt : detectedSystemMessage,
        stream: true,
      }),
      onNotOkResponse: async (
        res,
        decision,
      ): Promise<DecisionOnNotOkResponse> => {
        if (res.status === 401) {
          // We don't retry if the API key is invalid.
          decision.retry = false;
          throw new Error(
            "API key is invalid. Please check your API key and try again.",
          );
        }

        if (res.status === 400) {
          const data = await res.text();

          // We don't retry if the model is invalid.
          decision.retry = false;
          throw new Error(
            data,
          );
        }

        return decision;
      },
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);

    return result;
  }
}
