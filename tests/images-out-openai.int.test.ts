import { describe, it, expect } from 'vitest';
import { Img } from '../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;
 
describe.skipIf(!run)('OpenAI image generation (integration)', () => {
  it('generates an image URL or base64', async () => {
    const openai = Img.openai({ apiKey: apiKey as string, model: 'gpt-image-1' });

    const res = await openai.generate('A simple red square, minimalistic, solid color', { responseFormat: 'url', size: '1024x1024' });

    expect(res.images && res.images.length).toBeGreaterThan(0);
    const img = res.images![0]!;

    if (img.url) {
      expect(typeof img.url).toBe('string');
      expect(img.url.length).toBeGreaterThan(10);
    } else if (img.base64) {
      expect(typeof img.base64).toBe('string');
      expect(img.base64.length).toBeGreaterThan(100);
    } else {
      throw new Error('No image data returned');
    }
  });
});