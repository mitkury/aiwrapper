import { describe, it, expect } from 'vitest';
import { Lang, LangChatMessageCollection } from '../../dist/index.js';
import { readImageBase64 } from '../utils/test-images.ts';

const apiKey = process.env.ANTHROPIC_API_KEY;
const run = !!apiKey;
 
 describe.skipIf(!run)('Anthropic vision input (integration)', () => {
  it('accepts base64 image + text and returns an answer', async () => {
    const lang = Lang.anthropic({ apiKey: apiKey as string, model: 'claude-3-sonnet-20240229' });

    const { base64, mimeType } = await readImageBase64(import.meta.url, 'image-in-test', 'cat.jpg');

    const messages = new LangChatMessageCollection();
    messages.addUserContent([
      { type: 'text', text: 'Name the animal in one word' },
      { type: 'image', image: { kind: 'base64', base64, mimeType } }
    ]);

    const res = await lang.chat(messages);
    expect(typeof res.answer).toBe('string');
    expect(res.answer.length).toBeGreaterThan(0);
  });
});


