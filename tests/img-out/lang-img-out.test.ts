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

    console.log('Generated images:', res.images.length);
    
    // Save the first generated image to a file
    if (res.images.length > 0) {
      const image = res.images[0];
      if (image.base64) {
        // Convert base64 to buffer and save
        const buffer = Buffer.from(image.base64, 'base64');
        const filename = `generated-image-${Date.now()}.${image.mimeType?.split('/')[1] || 'png'}`;
        const filepath = join(process.cwd(), 'tests', 'img-out', filename);
        
        writeFileSync(filepath, buffer);
        console.log(`Saved generated image to: ${filepath}`);
        
        // Verify the image was saved
        expect(res.images.length).toBeGreaterThan(0);
        expect(image.base64).toBeDefined();
        expect(image.mimeType).toBeDefined();
      }
    } else {
      console.log('No images generated');
    }
  });
}

