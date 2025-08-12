import { describe, it, expect } from 'vitest';
import { Lang } from '../dist/index.js';

const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
const run = !!apiKey && process.env.RUN_IMAGE_OUT_TESTS === '1';

describe.skipIf(!run)('xAI Grok image generation (integration)', () => {
  it('generates an image URL or base64', async () => {
    const xai = Lang.xai({ apiKey: apiKey as string, model: 'grok-2-image' });

    const res = await (xai as any).generateImage('A minimalistic green triangle on white background');

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