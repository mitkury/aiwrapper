# Test Utilities

This directory contains utilities for testing AIWrapper language providers.

## Lang Gatherer (`lang-gatherer.ts`)

The `lang-gatherer` utility provides a consistent way to gather and test language providers across different test files.

### Features

- **Automatic provider detection** based on environment variables
- **Flexible provider selection** with include/exclude options
- **Model overrides** for custom model selection
- **Test runner helper** for consistent test structure
- **Individual provider access** for focused testing

### Usage Examples

#### 1. Simple Test Runner (Recommended)

```typescript
import { createLangTestRunner } from '../utils/lang-gatherer.js';

createLangTestRunner((lang) => {
  it('should respond to questions', async () => {
    const res = await lang.ask('What is the capital of France?');
    expect(res.answer.toLowerCase()).toContain('paris');
  });
});
```

#### 2. Custom Provider Selection

```typescript
import { gatherLangs } from '../utils/lang-gatherer.js';

const langs = gatherLangs({
  includeOpenAI: true,
  includeOpenAIResponses: false,
  includeOpenRouter: true,
  includeAnthropic: false,
  modelOverrides: {
    openai: 'gpt-4o-mini',
    openrouter: 'gpt-4o-mini'
  }
});

describe.skipIf(langs.length === 0)('Custom Tests', () => {
  for (const lang of langs) {
    describe(`${lang.name}`, () => {
      // Your tests here
    });
  }
});
```

#### 3. Single Provider Testing

```typescript
import { getProvider } from '../utils/lang-gatherer.js';

const openaiLang = getProvider('openai', 'gpt-4o-mini');

it.skipIf(!openaiLang)('OpenAI specific test', async () => {
  const res = await openaiLang!.ask('Hello!');
  expect(res.answer).toBeDefined();
});
```

#### 4. Provider Availability Check

```typescript
import { isProviderAvailable } from '../utils/lang-gatherer.js';

if (isProviderAvailable('anthropic')) {
  // Run Anthropic-specific tests
}
```

### Available Functions

- `gatherLangs(options?)` - Get array of available providers
- `createLangTestRunner(testFunction, options?)` - Create test runner for multiple providers
- `getAvailableLangs(options?)` - Alias for `gatherLangs`
- `isProviderAvailable(providerName)` - Check if specific provider is available
- `getProvider(name, model?)` - Get single provider by name

### Provider Names

- `'openai'` - OpenAI Completions API
- `'openai-responses'` - OpenAI Responses API
- `'openrouter'` - OpenRouter
- `'anthropic'` - Anthropic

### Environment Variables Required

- `OPENAI_API_KEY` - For OpenAI and OpenAI Responses APIs
- `OPENROUTER_API_KEY` - For OpenRouter
- `ANTHROPIC_API_KEY` - For Anthropic

### Benefits

1. **Consistency** - All tests use the same provider gathering logic
2. **Flexibility** - Easy to include/exclude specific providers
3. **Maintainability** - Centralized provider configuration
4. **Reusability** - Same utility across all test files
5. **Environment-aware** - Automatically adapts to available API keys
