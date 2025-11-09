import { describe, it, expect, assert } from 'vitest';
import { LangMessages, LanguageProvider } from 'aiwrapper';
import { createLangTestRunner } from '../utils/lang-gatherer.js';
import { readImageBase64 } from '../utils/test-images.ts';
import { writeFileSync } from 'fs';
import { join } from 'path';

describe('Lang - image in (providers)', () => {
  // Focus on OpenAI, OpenRouter, Anthropic. Others will be picked up only if configured.
  createLangTestRunner(runTest, {
    overrideProviders: ['openai'],
    modelOverrides: {
      // Ensure OpenRouter uses an explicit provider/model path for vision
      //openrouter: 'openai/gpt-4o-mini',
      openai: 'gpt-4o',
      //anthropic: 'claude-3-5-sonnet-20240620'
    }
  });
});

async function runTest(lang: LanguageProvider) {
  it('should generate an image', async () => {

    const messages = new LangMessages();
    messages.addUserMessage("Generate a photo of a gray coffee mug with flat white on a wooden table");
    messages.availableTools = [{ name: "image_generation" }];
    const res = await lang.chat(messages);

    const assistantImages = res.assistantImages;
    assert(assistantImages && assistantImages.length > 0, 'No images generated');

    const image = res.assistantImages[0];
    expect(image.base64 || image.url).toBeDefined();
    if (image.base64) {
      expect(image.mimeType).toBeDefined();
      expect(image.mimeType!.startsWith('image/')).toBe(true);
    }
    if (image.base64) {
      // Convert base64 to buffer and save
      const buffer = Buffer.from(image.base64, 'base64');
      const filename = `generated-image-${Date.now()}.${image.mimeType?.split('/')[1] || 'png'}`;
      const filepath = join(process.cwd(), 'tests', 'img-out', filename);

      writeFileSync(filepath, buffer);
      console.log(`Saved generated image to: ${filepath}`);

      // Verify the image was saved
      expect(res.assistantImages.length).toBeGreaterThan(0);
      expect(image.base64).toBeDefined();
      expect(image.mimeType).toBeDefined();
    }
    
    // Validate single consolidated assistant message (image + optional text)
    const last = res[res.length - 1];
    expect(last.role).toBe('assistant');
    const imageItem = last.items.find(item => item.type === 'image') as any;
    expect(imageItem).toBeDefined();
    expect(imageItem.base64 || imageItem.url).toBeDefined();
    // Ensure we didn't split into two assistant messages at the end
    const prev = res.length > 1 ? res[res.length - 2] : undefined;
    expect(prev?.role).not.toBe('assistant');

  });
}

