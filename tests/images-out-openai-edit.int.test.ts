import { describe, it, expect } from 'vitest';
import { Img } from '../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey && process.env.RUN_IMAGE_OUT_TESTS === '1';

// 1x1 transparent PNG
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAgMBgQ7h1i8AAAAASUVORK5CYII=';

describe.skipIf(!run)('OpenAI image edit (integration)', () => {
  it('edits an image and returns url or base64', async () => {
    const openai = Img.openai({ apiKey: apiKey as string, model: 'gpt-image-1' });

    const res = await openai.edit({
      prompt: 'make it red',
      image: { kind: 'base64', base64: TINY_PNG_BASE64, mimeType: 'image/png' },
      responseFormat: 'url'
    });

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