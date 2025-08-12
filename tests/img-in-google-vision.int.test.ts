import { describe, it, expect } from 'vitest';
import { Lang, LangChatMessageCollection } from '../dist/index.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const run = !!apiKey && process.env.RUN_VISION_TESTS === '1';

describe.skipIf(!run)('Google Gemini vision (integration)', () => {
  it('accepts base64 image + text and returns an answer', async () => {
    const lang = Lang.google({ apiKey: apiKey as string, model: 'gemini-2.0-flash' });

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const catPath = path.resolve(__dirname, 'img', 'cat.jpg');
    const base64 = (await readFile(catPath)).toString('base64');

    const messages = new LangChatMessageCollection();
    messages.addUserContent([
      { type: 'text', text: 'Name the animal in one word' },
      { type: 'image', image: { kind: 'base64', base64, mimeType: 'image/jpeg' } }
    ]);

    const res = await lang.chat(messages);
    expect(typeof res.answer).toBe('string');
    expect(res.answer.length).toBeGreaterThan(0);
  });
});


