import { describe, it, expect } from 'vitest';
import { Lang, LangChatMessageCollection } from '../../dist/index.js';
import { readImageBase64 } from '../utils/test-images.ts';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

// Ensure we test streaming path for OpenAI vision-capable models
// Use gpt-4o which supports streaming and vision

describe.skipIf(!run)('OpenAI vision streaming (integration)', () => {
  it('streams answer via onResult when sending base64 image + text', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-4o' });

    const { base64, mimeType } = await readImageBase64(import.meta.url, 'image-in-test', 'cat.jpg');

    const messages = new LangChatMessageCollection();
    messages.addUserContent([
      { type: 'text', text: 'Name the animal in one word' },
      { type: 'image', image: { kind: 'base64', base64, mimeType } }
    ]);

    let updates = 0;
    const res = await lang.chat(messages, { onResult: () => { updates++; } });

    expect(typeof res.answer).toBe('string');
    expect(res.answer.length).toBeGreaterThan(0);
    expect(updates).toBeGreaterThan(0);
  });
});