import { models, AIModels, ModelCollection } from 'aimodels';
import { OpenAILang, OpenAILangOptions } from "./openai/openai-lang.ts";
import { AnthropicLang, AnthropicLangOptions  } from "./anthropic/anthropic-lang.ts";
import { OllamaLang, OllamaLangOptions } from "./ollama/ollama-lang.ts";
import { GroqLang, GroqLangOptions } from "./groq/groq-lang.ts";
import { DeepSeekLang, DeepSeekLangOptions } from "./deepseek/deepseek-lang.ts";
import { XAILang, XAILangOptions } from "./xai/xai-lang.ts";
import { GoogleLang, GoogleLangOptions } from "./google/google-lang.ts";
import { CohereLang, CohereLangOptions } from "./cohere/cohere-lang.ts";
import { OpenRouterLang, OpenRouterLangOptions } from "./openrouter/openrouter-lang.ts";
import { MistralLang, MistralLangOptions } from "./mistral/mistral-lang.ts";
import { OpenAILikeLang } from "./openai-like/openai-like-lang.ts";

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
  }): OpenAILikeLang {
    return OpenAILikeLang.custom(options);
  }

  // Dynamic provider access
  static [Symbol.iterator](): Iterator<any> {
    const providers = models.providers.reduce((acc: Record<string, Function>, provider: any) => {
      // Handle provider as object with id property (new aimodels behavior)
      const providerId = typeof provider === 'object' && provider !== null ? provider.id : provider;
      if (providerId in this) {
        acc[providerId] = this[providerId];
      }
      return acc;
    }, {});
    return Object.values(providers)[Symbol.iterator]();
  }

  // Array-like access to providers
  static [key: string]: any;
}