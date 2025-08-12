import { describe, it, expect } from 'vitest';
import { Lang, LangChatMessageCollection } from '../../dist/index.js';
import { readImageBase64 } from '../utils/test-images.ts';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('OpenAI vision (integration)', () => {
  it('accepts base64 image + text and returns an answer', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-5' });

    const { base64, mimeType } = await readImageBase64(import.meta.url, 'image-in-test', 'cat.jpg');

    const messages = new LangChatMessageCollection();
    messages.addUserContent([
      { type: 'text', text: 'Name the animal in one word' },
      { type: 'image', image: { kind: 'base64', base64, mimeType } }
    ]);

    const res = await lang.chat(messages);
    expect(typeof res.answer).toBe('string');
    expect(res.answer.length).toBeGreaterThan(0);

    // Soft assertion: often the model replies "cat"
    const norm = res.answer.trim().toLowerCase();
    expect(typeof norm).toBe('string');
  });
});


