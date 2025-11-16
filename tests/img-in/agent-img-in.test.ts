import { describe, it, expect } from 'vitest';
import { ChatAgent, LangMessages, LanguageProvider } from 'aiwrapper';
import { createLangTestRunner } from '../utils/lang-gatherer.js';
import { readImageBase64 } from '../utils/test-images.ts';

describe('ChatAgent', () => {
  createLangTestRunner(runTest);
});

async function runTest(lang: LanguageProvider) {
  it('should identify a cat in the image', async () => {
    const { base64, mimeType } = await readImageBase64(import.meta.url, 'image-in-test', 'test-image.jpg');

    const messages = new LangMessages();
    messages.addUserItems([
      { type: 'text', text: 'Look at the image and identify the animal. Answer succinctly.' },
      { type: 'image', base64, mimeType }
    ]);

    const agent = new ChatAgent(lang);
    const result = await agent.run(messages);
    expect(result).toBeDefined();
    const norm = result!.answer.trim().toLowerCase();
    expect(norm.length).toBeGreaterThan(0);
    expect(norm).toContain('cat');

  });
}