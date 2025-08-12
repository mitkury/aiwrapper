import { describe, it, expect } from 'vitest';

const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
const run = false && !!apiKey && process.env.RUN_IMAGE_OUT_TESTS === '1';

describe.skipIf(!run)('xAI Grok image generation (integration)', () => {
  it('generates an image URL or base64', async () => {
    throw new Error('Not implemented via Img yet');
  });
});