import { describe, it, expect } from 'vitest';
import { LangMessages, LanguageProvider } from 'aiwrapper';
import { createLangTestRunner } from '../utils/lang-gatherer.js';
import { readImageBase64 } from '../utils/test-images.ts';

describe('Lang - image in (providers)', () => {
  // Focus on OpenAI (Responses), OpenRouter, Anthropic. Others will be picked up only if configured.
  createLangTestRunner(runTest, {
    includeOpenAI: true,
    includeOpenAIResponses: false,
    includeOpenRouter: true,
    includeAnthropic: true,
    modelOverrides: {
      // Ensure OpenRouter uses an explicit provider/model path for vision
      openrouter: 'openai/gpt-4o-mini',
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-sonnet-20240620'
    }
  });
});

async function runTest(lang: LanguageProvider) {
  it('should identify a cat in the image', async () => {
    const { base64, mimeType } = await readImageBase64(import.meta.url, 'image-in-test', 'test-image.jpg');

    const messages = new LangMessages();
    messages.addUserContent([
      { type: 'text', text: 'Look at the image and identify the animal. Answer succinctly.' },
      { type: 'image', image: { kind: 'base64', base64, mimeType } }
    ]);

    const res = await lang.chat(messages);
    const norm = res.answer.trim().toLowerCase();
    expect(norm.length).toBeGreaterThan(0);
    expect(norm).toContain('cat');
  });
}

