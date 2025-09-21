import { describe } from 'vitest';
import { Lang, LanguageProvider } from '../../dist/index.js';

export interface LangGathererOptions {
  /** Include OpenAI Completions API */
  includeOpenAI?: boolean;
  /** Include OpenAI Responses API */
  includeOpenAIResponses?: boolean;
  /** Include OpenRouter */
  includeOpenRouter?: boolean;
  /** Include Anthropic */
  includeAnthropic?: boolean;
  /** Custom model overrides */
  modelOverrides?: {
    openai?: string;
    openaiResponses?: string;
    openrouter?: string;
    anthropic?: string;
  };
}

/**
 * Gathers available language providers based on environment variables and options
 */
export function gatherLangs(options: LangGathererOptions = {}): LanguageProvider[] {
  const {
    includeOpenAI = true,
    includeOpenAIResponses = true,
    includeOpenRouter = true,
    includeAnthropic = true,
    modelOverrides = {}
  } = options;

  const langs: LanguageProvider[] = [];

  // OpenAI Completions API
  if (includeOpenAI && process.env.OPENAI_API_KEY) {
    langs.push(Lang.openai({
      apiKey: process.env.OPENAI_API_KEY as string,
      model: modelOverrides.openai || 'gpt-4o-mini'
    }));
  }

  // OpenAI Responses API (same as regular OpenAI - it uses Responses API by default)
  if (includeOpenAIResponses && process.env.OPENAI_API_KEY && !includeOpenAI) {
    langs.push(Lang.openai({
      apiKey: process.env.OPENAI_API_KEY as string,
      model: modelOverrides.openaiResponses || 'gpt-4o-mini'
    }));
  }

  // OpenRouter
  if (includeOpenRouter && process.env.OPENROUTER_API_KEY) {
    langs.push(Lang.openrouter({
      apiKey: process.env.OPENROUTER_API_KEY as string,
      model: modelOverrides.openrouter || 'gpt-4o-mini'
    }));
  }

  // Anthropic
  if (includeAnthropic && process.env.ANTHROPIC_API_KEY) {
    langs.push(Lang.anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY as string,
      model: modelOverrides.anthropic || 'claude-3-5-sonnet-20240620'
    }));
  }

  return langs;
}

/**
 * Creates a test runner that runs tests for each available language provider
 */
export function createLangTestRunner(
  testFunction: (lang: LanguageProvider) => void,
  options: LangGathererOptions = {}
) {
  const langs = gatherLangs(options);

  for (const lang of langs) {
    describe(`${lang.constructor.name} (${lang.name})`, () => {
      testFunction(lang);
    });
  }
}

/**
 * Gets available providers as a simple array for custom test logic
 */
export function getAvailableLangs(options: LangGathererOptions = {}): LanguageProvider[] {
  return gatherLangs(options);
}

/**
 * Checks if a specific provider is available
 */
export function isProviderAvailable(providerName: string): boolean {
  switch (providerName.toLowerCase()) {
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY;
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY;
    default:
      return false;
  }
}

/**
 * Gets a single provider by name (useful for focused testing)
 */
export function getProvider(name: string, model?: string): LanguageProvider | null {
  switch (name.toLowerCase()) {
    case 'openai':
      if (process.env.OPENAI_API_KEY) {
        return Lang.openai({
          apiKey: process.env.OPENAI_API_KEY as string,
          model: model || 'gpt-4o-mini'
        });
      }
      break;
    case 'openrouter':
      if (process.env.OPENROUTER_API_KEY) {
        return Lang.openrouter({
          apiKey: process.env.OPENROUTER_API_KEY as string,
          model: model || 'gpt-4o-mini'
        });
      }
      break;
    case 'anthropic':
      if (process.env.ANTHROPIC_API_KEY) {
        return Lang.anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY as string,
          model: model || 'claude-3-5-sonnet-20240620'
        });
      }
      break;
  }
  return null;
}
