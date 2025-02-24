import { LangChatMessages, LangResultWithMessages, LangResultWithString, LanguageProvider } from "../language-provider.ts";
import { httpRequestWithRetry as fetch } from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";

export type OllamaLangOptions = {
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  url?: string;
};

export type OllamaLangConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  baseURL: string;
};

export class OllamaLang extends OpenAILikeLang {
  constructor(options: OllamaLangOptions) {
    const modelName = options.model || "llama2:latest";
    
    super({
      apiKey: "",
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: options.url || "http://localhost:11434",
    });
    
    // For Ollama, we require the model to be in aimodels database
    if (!this.modelInfo) {
      console.error(`Invalid Ollama model: ${modelName}. Model not found in aimodels database.`);
    }
  }

  protected override transformBody(body: Record<string, unknown>): Record<string, unknown> {
    // Ollama uses context_length instead of max_tokens
    if (body.max_tokens) {
      const { max_tokens, ...rest } = body;
      return {
        ...rest,
        context_length: max_tokens
      };
    }
    return body;
  }

  override async ask(
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

    const response = await fetch(`${this._config.baseURL}/api/generate`, {
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

  override async chat(messages: LangChatMessages, onResult?: (result: LangResultWithMessages) => void): Promise<LangResultWithMessages> {
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

    const response = await fetch(`${this._config.baseURL}/api/chat`, {
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
