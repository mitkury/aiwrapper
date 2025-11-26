import { describe } from 'vitest';
import { Lang, LanguageProvider } from 'aiwrapper';

export interface LangProvider {
  name: string;
  lang: LanguageProvider;
}

/** Supported provider names */
export type SupportedProvider = 'openai' | 'openrouter' | 'anthropic' | 'google' | 'deepseek';

export interface LangGathererOptions {
  /** Custom model overrides */
  modelOverrides?: {
    openai?: string;
    openrouter?: string;
    anthropic?: string;
    google?: string;
    deepseek?: string;
  };
  /** Specific providers to include (overrides other options) */
  providers?: SupportedProvider[];
  /** Override providers - if provided, only use these providers; otherwise use all available */
  overrideProviders?: SupportedProvider[];
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
      if (['openai', 'openrouter', 'anthropic', 'google', 'deepseek'].includes(providerName)) {
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
  // Check for provider filters from env/CLI
  const providerFilters = getProviderFilters();
  
  const {
    modelOverrides = {},
    providers,
    overrideProviders
  } = options;

  // Determine which providers to use
  // PROVIDERS env var is the final authority - if set, it filters everything
  let activeProviders: SupportedProvider[] | undefined;
  
  if (providerFilters.length > 0) {
    // PROVIDERS env var is set - it's the final authority
    const envProvidersLower = providerFilters.map(p => p.toLowerCase());
    
    if (overrideProviders !== undefined && overrideProviders.length > 0) {
      // Intersect overrideProviders with PROVIDERS env var
      // Only include providers that are in both lists (case-insensitive)
      activeProviders = overrideProviders.filter(p => 
        envProvidersLower.includes(p.toLowerCase())
      ) as SupportedProvider[];
      // If intersection is empty, return empty array (test will be skipped)
      if (activeProviders.length === 0) {
        return [];
      }
    } else {
      // No overrideProviders, use PROVIDERS env var directly
      activeProviders = providerFilters as SupportedProvider[];
    }
  } else {
    // No PROVIDERS env var - use normal precedence
    // If overrideProviders is explicitly provided and non-empty, use only those
    // Otherwise, if providers is provided, use those
    // Otherwise, use all available providers
    activeProviders = (overrideProviders !== undefined && overrideProviders.length > 0)
      ? overrideProviders 
      : (providers ?? undefined);
  }

  const langs: LanguageProvider[] = [];

  // Helper function to check if provider should be included
  const shouldIncludeProvider = (providerName: string): boolean => {
    // If activeProviders is undefined or empty, include all available providers
    if (!activeProviders || activeProviders.length === 0) {
      return true;
    }
    // Otherwise, only include providers in the list
    return activeProviders.map(p => p.toLowerCase()).includes(providerName.toLowerCase());
  };

  // OpenAI
  if (process.env.OPENAI_API_KEY && shouldIncludeProvider('openai')) {
    langs.push(Lang.openai({
      apiKey: process.env.OPENAI_API_KEY as string,
      model: modelOverrides.openai || 'gpt-5-nano'
    }));
  }

  // OpenRouter
  if (process.env.OPENROUTER_API_KEY && shouldIncludeProvider('openrouter')) {
    langs.push(Lang.openrouter({
      apiKey: process.env.OPENROUTER_API_KEY as string,
      model: modelOverrides.openrouter || 'google/gemini-2.5-flash'
    }));
  }

  // Anthropic
  if (process.env.ANTHROPIC_API_KEY && shouldIncludeProvider('anthropic')) {
    langs.push(Lang.anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY as string,
      model: modelOverrides.anthropic || 'claude-3-7-sonnet-20250219'
    }));
  }

  // Google
  if (process.env.GOOGLE_API_KEY && shouldIncludeProvider('google')) {
    langs.push(Lang.google({
      apiKey: process.env.GOOGLE_API_KEY as string,
      model: modelOverrides.google || 'gemini-2.5-flash-preview'
    }));
  }

  // DeepSeek
  if (process.env.DEEPSEEK_API_KEY && shouldIncludeProvider('deepseek')) {
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

  // If no providers match after filtering, skip the entire test suite
  if (namedLangs.length === 0) {
    describe.skip('No matching providers (filtered by PROVIDERS env var)', () => {
      // Empty test suite - will be skipped
    });
    return;
  }

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
  const { overrideProviders, providers } = options;
  
  console.log('\n🔧 Available Language Providers:');
  
  // Show what filtering is active
  if (overrideProviders !== undefined && overrideProviders.length > 0) {
    console.log(`   Using overrideProviders: ${overrideProviders.join(', ')}`);
  } else if (providers !== undefined) {
    console.log(`   Using providers option: ${providers.length > 0 ? providers.join(', ') : '(empty - no providers)'}`);
  } else if (providerFilters.length > 0) {
    console.log(`   Filtered by env/CLI: ${providerFilters.join(', ')}`);
  } else {
    console.log(`   Using all available providers`);
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
