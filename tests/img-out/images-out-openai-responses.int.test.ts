import { describe, it, expect } from 'vitest';
import { Lang } from 'aiwrapper';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('OpenAI image generation via Responses API (integration)', () => {
  it('generates an image base64 using image_generation tool', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-4o' });

    const res = await (lang as any).ask('Generate an image of a gray tabby cat hugging an otter with an orange scarf', {
      tools: [ { type: 'image_generation' } ]
    });

    expect(res.images && res.images.length).toBeGreaterThan(0);
    const img = res.images![0]!;

    expect(typeof img.base64).toBe('string');
    expect(img.base64 && img.base64.length).toBeGreaterThan(100);
  });
});