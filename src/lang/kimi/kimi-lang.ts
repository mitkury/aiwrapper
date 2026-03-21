import type { LangOptions } from "../language-provider.ts";
import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";

export type KimiThinkingMode = {
  type: "enabled" | "disabled";
};

export type KimiLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  thinking?: KimiThinkingMode;
  promptCacheKey?: string;
  safetyIdentifier?: string;
  bodyProperties?: Record<string, unknown>;
  defaultOptions?: LangOptions;
};

export class KimiLang extends OpenAIChatCompletionsLang {
  constructor(options: KimiLangOptions) {
    const modelName = options.model || "kimi-k2.5";

    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: "https://api.moonshot.ai/v1",
      bodyProperties: {
        ...(options.bodyProperties || {}),
        ...(options.thinking ? { thinking: options.thinking } : {}),
        ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
        ...(options.safetyIdentifier ? { safety_identifier: options.safetyIdentifier } : {}),
      },
      defaultOptions: options.defaultOptions,
    });
  }

  protected override transformBody(body: Record<string, unknown>): Record<string, unknown> {
    const transformedBody = super.transformBody(body);

    if (this._config.maxTokens === undefined) {
      delete transformedBody.max_tokens;
      delete transformedBody.max_completion_tokens;
      return transformedBody;
    }

    if (typeof transformedBody.max_tokens === "number" && transformedBody.max_completion_tokens === undefined) {
      transformedBody.max_completion_tokens = transformedBody.max_tokens;
    }

    delete transformedBody.max_tokens;

    return transformedBody;
  }
}
