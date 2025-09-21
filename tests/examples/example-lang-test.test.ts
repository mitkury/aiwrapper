import { describe, it, expect } from 'vitest';
import { LanguageProvider } from '../../dist/index.js';
import { createLangTestRunner, gatherLangs, getProvider } from '../utils/lang-gatherer.js';

// Example 1: Using the test runner (recommended for most cases)
createLangTestRunner((lang: LanguageProvider) => {
  it('should respond with a greeting', async () => {
    const res = await lang.ask('Say "Hello World"');
    expect(res.answer.toLowerCase()).toContain('hello');
  });

  it('should handle multiple messages', async () => {
    const res = await lang.chat([
      { role: 'user', content: 'Count to 3' },
      { role: 'assistant', content: '1, 2, 3' },
      { role: 'user', content: 'What comes after 3?' }
    ]);
    expect(res.answer).toContain('4');
  });
});

// Example 2: Custom test with specific provider selection
describe('OpenAI Only Tests', () => {
  const openaiLang = getProvider('openai');
  
  it.skipIf(!openaiLang)('should work with OpenAI specifically', async () => {
    const res = await openaiLang!.ask('What is 2+2?');
    expect(res.answer).toContain('4');
  });
});

// Example 3: Custom provider gathering with options
describe('Custom Provider Tests', () => {
  const specificLangs = gatherLangs({
    includeOpenAI: true,
    includeOpenAIResponses: false, // Skip the responses API
    includeOpenRouter: false,      // Skip OpenRouter
    includeAnthropic: true,
    modelOverrides: {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-sonnet-20240620'
    }
  });

  describe.skipIf(specificLangs.length === 0)('Selected Providers', () => {
    for (const lang of specificLangs) {
      describe(`${lang.name}`, () => {
        it('should handle JSON responses', async () => {
          const res = await lang.askForObject('Return a JSON object with a "color" property set to "blue"', {
            color: 'string'
          });
          expect(res.object?.color).toBe('blue');
        });
      });
    }
  });
});
