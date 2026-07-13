import { models, type ModelCollection } from 'aimodels';
import { OpenAILang } from "./openai/openai-lang.js";
import type { OpenAILangOptions } from "./openai/responses/openai-responses-lang.js";
import { AnthropicLang, type AnthropicLangOptions } from "./anthropic/anthropic-lang.js";
import { OllamaLang, type OllamaLangOptions } from "./ollama/ollama-lang.js";
import { GroqLang, type GroqLangOptions } from "./groq/groq-lang.js";
import { DeepSeekLang, type DeepSeekLangOptions } from "./deepseek/deepseek-lang.js";
import { KimiLang, type KimiLangOptions } from "./kimi/kimi-lang.js";
import { XAILang, type XAILangOptions } from "./xai/xai-lang.js";
import { GoogleLang, type GoogleLangOptions } from "./google/google-lang.js";
import { CohereLang, type CohereLangOptions } from "./cohere/cohere-lang.js";
import { OpenRouterLang, type OpenRouterLangOptions } from "./openrouter/openrouter-lang.js";
import { MistralLang, type MistralLangOptions } from "./mistral/mistral-lang.js";
import { OpenAIChatCompletionsLang } from "./openai/openai-chat-completions-lang.js";
import { MockOpenAILikeLang, type MockOpenAILikeOptions } from "./mock/mock-openai-like-lang.js";
import { MockResponseStreamLang, type MockResponseStreamOptions } from "./mock/mock-response-stream-lang.js";
import type { LangOptions } from "./language-provider.js";

/**
 * Lang is a factory class for using language models from different providers. 
 */
export abstract class Lang {
  /** Get all language models */
  static get models(): ModelCollection {
    return models.can("chat");
  }

  /** Create an OpenAI provider instance */
  static openai(options: OpenAILangOptions): OpenAILang {
    return new OpenAILang(options);
  }

  /** Create an Anthropic provider instance */
  static anthropic(options: AnthropicLangOptions): AnthropicLang {
    return new AnthropicLang(options);
  }

  /** Create an Ollama provider instance */
  static ollama(options: OllamaLangOptions): OllamaLang {
    return new OllamaLang(options);
  }

  /** Create a Groq provider instance */
  static groq(options: GroqLangOptions): GroqLang {
    return new GroqLang(options);
  }

  /** Create a DeepSeek provider instance */
  static deepseek(options: DeepSeekLangOptions): DeepSeekLang {
    return new DeepSeekLang(options);
  }

  /** Create a Moonshot Kimi provider instance */
  static kimi(options: KimiLangOptions): KimiLang {
    return new KimiLang(options);
  }

  /** Create an xAI provider instance */
  static xai(options: XAILangOptions): XAILang {
    return new XAILang(options);
  }

  /** Create a Google provider instance */
  static google(options: GoogleLangOptions): GoogleLang {
    return new GoogleLang(options);
  }

  /** Create a Cohere provider instance */
  static cohere(options: CohereLangOptions): CohereLang {
    return new CohereLang(options);
  }

  /** Create an OpenRouter provider instance */
  static openrouter(options: OpenRouterLangOptions): OpenRouterLang {
    return new OpenRouterLang(options);
  }

  /** Create a Mistral provider instance */
  static mistral(options: MistralLangOptions): MistralLang {
    return new MistralLang(options);
  }

  /**
   * Creates an instance for custom OpenAI-compatible APIs
   * @param options Configuration options for the custom API
   * @returns A new OpenAILikeLang instance
   */
  static openaiLike(options: {
    apiKey?: string;
    model: string;
    baseURL: string;
    systemPrompt?: string;
    maxTokens?: number;
    headers?: Record<string, string>;
    bodyProperties?: Record<string, unknown>;
    defaultOptions?: LangOptions;
  }): OpenAIChatCompletionsLang {
    return OpenAIChatCompletionsLang.custom(options);
  }

  /** Create a Mock OpenAI-like provider (no network) */
  static mockOpenAI(options: MockOpenAILikeOptions = {}): MockOpenAILikeLang {
    return new MockOpenAILikeLang(options);
  }
  
  /** Create a lightweight streaming mock provider */
  static mockResponseStream(options: MockResponseStreamOptions = {}): MockResponseStreamLang {
    return new MockResponseStreamLang(options);
  }

}
