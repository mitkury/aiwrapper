import { describe, it, expect } from 'vitest';
import { Lang } from '../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey && process.env.RUN_IMAGE_OUT_TESTS === '1';

describe.skipIf(!run)('OpenAI image generation (integration)', () => {
  it('generates an image URL or base64', async () => {
    const openai = Lang.openai({ apiKey: apiKey as string, model: 'gpt-image-1' });

    const res = await (openai as any).generateImage('A simple red square, minimalistic, solid color', { imageOutput: 'url', size: '1024x1024' });

    expect(res.images && res.images.length).toBeGreaterThan(0);
    const img = res.images![0]!;

    // We just check that provider returned something that looks like an image per docs
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