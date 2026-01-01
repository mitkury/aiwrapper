import { describe, it, expect, assert } from 'vitest';
import { LangMessages, LanguageProvider } from 'aiwrapper';
import { createLangTestRunner } from '../utils/lang-gatherer.js';
import { readImageBase64 } from '../utils/test-images.ts';

describe('Lang - image in (providers)', () => {
  // Focus on OpenAI, OpenRouter, Anthropic. Others will be picked up only if configured.
  createLangTestRunner(runTest, {
    overrideProviders: ['openai', 'openrouter', 'anthropic']
  });
});

async function runTest(lang: LanguageProvider) {

  it('should identify a cat in the image', async () => {
    const { base64, mimeType } = await readImageBase64(import.meta.url, 'image-in-test', 'test-image.jpg');

    const messages = new LangMessages();
    messages.addUserItems([
      { type: 'text', text: 'Look at the image and identify the animal. Answer succinctly.' },
      { type: 'image', base64, mimeType }
    ]);

    const res = await lang.chat(messages);
    const norm = res.answer.trim().toLowerCase();
    expect(norm.length).toBeGreaterThan(0);
    expect(norm).toContain('cat');
  });

  it('should accept an image coming from an assistant', async () => {
    const { base64, mimeType } = await readImageBase64(import.meta.url, 'image-in-test', 'test-image.jpg');

    const messages = new LangMessages();

    const dataUrl = `data:${mimeType};base64,` + base64;

    messages.addUserMessage("Generate a photo of a cute cat");
    messages.addAssistantItems([{
      type: "image",
      url: dataUrl,
      metadata: {
        revisedPrompt: "An image of a ginger cat sitting on a wooden table"
      }
    }]);
    messages.addUserMessage("Thanks! So cute. Now describe the image back to me");

    const res = await lang.chat(messages);

    expect(res[res.length - 1].role === "assistant").toBe(true);

    const answer = res[res.length - 1].text.toLocaleLowerCase();

    assert(answer.includes("ginger") || answer.includes("organge") || answer.includes("table"));
    
  });
}

