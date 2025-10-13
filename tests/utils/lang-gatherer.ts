import { describe } from 'vitest';
import { Lang, LanguageProvider } from '../../dist/index.js';

export interface LangProvider {
  name: string;
  lang: LanguageProvider;
}

export interface LangGathererOptions {
  /** Include OpenAI Completions API */
  includeOpenAI?: boolean;
  /** Include OpenAI Responses API */
  includeOpenAIResponses?: boolean;
  /** Include OpenRouter */
  includeOpenRouter?: boolean;
  /** Include Anthropic */
  includeAnthropic?: boolean;
  /** Include DeepSeek */
  includeDeepSeek?: boolean;
  /** Custom model overrides */
  modelOverrides?: {
    openai?: string;
    openaiResponses?: string;
    openrouter?: string;
    anthropic?: string;
    deepseek?: string;
  };
  /** Specific providers to include (overrides other options) */
  providers?: string[];
}

/**
 * Gets provider filters from environment variables or command line
 */
function getProviderFilters(): string[] {
  // First check environment variable
  const envProviders = process.env.PROVIDERS;
  if (envProviders) {
    return envProviders.split(',').map(p => p.trim().toLowerCase());
  }
  
  // Then check command line arguments (after vitest arguments)
  const args = process.argv.slice(2);
  const providers: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && !args[i].startsWith('--reporter') && !args[i].startsWith('--run')) {
      const providerName = args[i].substring(2).toLowerCase();
      if (['openai', 'openrouter', 'anthropic', 'deepseek'].includes(providerName)) {
        providers.push(providerName);
      }
    }
  }
  
  return providers;
}

/**
 * Gathers available language providers based on environment variables and options
 */
export function gatherLangs(options: LangGathererOptions = {}): LanguageProvider[] {
  // Check for provider filters
  const providerFilters = getProviderFilters();
  
  const {
    includeOpenAI = true,
    includeOpenRouter = true,
    includeAnthropic = true,
    includeDeepSeek = true,
    modelOverrides = {},
    providers = providerFilters
  } = options;

  const langs: LanguageProvider[] = [];

  // Helper function to check if provider should be included
  const shouldIncludeProvider = (providerName: string): boolean => {
    if (providers.length > 0) {
      return providers.includes(providerName.toLowerCase());
    }
    return true;
  };

  // OpenAI
  if (includeOpenAI && process.env.OPENAI_API_KEY && shouldIncludeProvider('openai')) {
    langs.push(Lang.openai({
      apiKey: process.env.OPENAI_API_KEY as string,
      model: modelOverrides.openaiResponses || 'gpt-5-nano'
    }));
  }

  // OpenRouter
  if (includeOpenRouter && process.env.OPENROUTER_API_KEY && shouldIncludeProvider('openrouter')) {
    langs.push(Lang.openrouter({
      apiKey: process.env.OPENROUTER_API_KEY as string,
      model: modelOverrides.openrouter || 'google/gemini-2.5-flash'
    }));
  }

  // Anthropic
  if (includeAnthropic && process.env.ANTHROPIC_API_KEY && shouldIncludeProvider('anthropic')) {
    langs.push(Lang.anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY as string,
      model: modelOverrides.anthropic || 'claude-opus-4-1-20250805'
    }));
  }

  // DeepSeek
  if (includeDeepSeek && process.env.DEEPSEEK_API_KEY && shouldIncludeProvider('deepseek')) {
    langs.push(Lang.deepseek({
      apiKey: process.env.DEEPSEEK_API_KEY as string,
      model: modelOverrides.deepseek || 'deepseek-chat'
    }));
  }

  return langs;
}

/**
 * Gathers available language providers with friendly names
 */
export function gatherLangsWithNames(options: LangGathererOptions = {}): LangProvider[] {
  const langs = gatherLangs(options);
  const namedLangs: LangProvider[] = [];

  for (const lang of langs) {
    let friendlyName = lang.constructor.name;
    
    // Add friendly names based on the provider type
    if (lang.constructor.name === 'OpenAILang') {
      friendlyName = 'OpenAI';
    } else if (lang.constructor.name === 'OpenRouterLang') {
      friendlyName = 'OpenRouter';
    } else if (lang.constructor.name === 'AnthropicLang') {
      friendlyName = 'Anthropic';
    } else if (lang.constructor.name === 'DeepSeekLang') {
      friendlyName = 'DeepSeek';
    }

    namedLangs.push({
      name: `${friendlyName} (${lang.name})`,
      lang: lang
    });
  }

  return namedLangs;
}

/**
 * Creates a test runner that runs tests for each available language provider
 */
export function createLangTestRunner(
  testFunction: (lang: LanguageProvider) => void,
  options: LangGathererOptions = {}
) {
  const namedLangs = gatherLangsWithNames(options);

  for (const { name, lang } of namedLangs) {
    describe(name, () => {
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
 * Gets available providers with friendly names for custom test logic
 */
export function getAvailableLangsWithNames(options: LangGathererOptions = {}): LangProvider[] {
  return gatherLangsWithNames(options);
}

/**
 * Prints available providers for debugging
 */
export function printAvailableProviders(options: LangGathererOptions = {}): void {
  const namedLangs = getAvailableLangsWithNames(options);
  const providerFilters = getProviderFilters();
  
  console.log('\n🔧 Available Language Providers:');
  if (providerFilters.length > 0) {
    console.log(`   Filtered by: ${providerFilters.join(', ')}`);
  }
  
  if (namedLangs.length === 0) {
    console.log('   ❌ No providers available');
    return;
  }
  
  for (const { name } of namedLangs) {
    console.log(`   ✅ ${name}`);
  }
  console.log();
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
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY;
    default:
      return false;
  }
}
