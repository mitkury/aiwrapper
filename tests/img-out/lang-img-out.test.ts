import { describe, it, expect } from 'vitest';
import { LangMessages, LanguageProvider } from 'aiwrapper';
import { createLangTestRunner } from '../utils/lang-gatherer.js';
import { readImageBase64 } from '../utils/test-images.ts';
import { writeFileSync } from 'fs';
import { join } from 'path';

describe('Lang - image in (providers)', () => {
  // Focus on OpenAI (Responses), OpenRouter, Anthropic. Others will be picked up only if configured.
  createLangTestRunner(runTest, {
    includeOpenAI: true,
    includeOpenAIResponses: true,
    includeOpenRouter: false,
    includeAnthropic: false,
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

    console.log('Generated images:', res.assistantImages.length);
    
    // Save the first generated image to a file
    if (res.assistantImages.length > 0) {
      const image = res.assistantImages[0];
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
      expect(Array.isArray(last.content)).toBe(true);
      const parts = last.content as any[];
      const hasImage = parts.some(p => p && p.type === 'image');
      expect(hasImage).toBe(true);
      // Ensure we didn't split into two assistant messages at the end
      const prev = res.length > 1 ? res[res.length - 2] : undefined;
      expect(prev?.role).not.toBe('assistant');
    } else {
      console.log('No images generated');
    }
  });
}

