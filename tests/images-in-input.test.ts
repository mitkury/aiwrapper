import { describe, it, expect } from 'vitest';
import { Lang, LangChatMessageCollection } from '../dist/index.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// For this unit test we don't need real model behavior; we'll use the mock provider
// and assert that our API accepts mixed content with a base64 image and returns a text answer.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAT_IMG_PATH = path.resolve(__dirname, 'img', 'cat.jpg');

describe('Images in input (mock, OpenAI-like mapping)', () => {
  it('accepts base64 image + text and returns a one-word answer', async () => {
    const mock = Lang.mockOpenAI({
      mockResponseText: 'cat'
    });

    const base64 = (await readFile(CAT_IMG_PATH)).toString('base64');

    const messages = new LangChatMessageCollection();
    messages.addUserContent([
      { type: 'text', text: 'Name the animal in one word (without "a" or "an" at the beginning)' },
      { type: 'image', image: { kind: 'base64', base64, mimeType: 'image/jpeg' } }
    ]);

    const res = await mock.chat(messages);

    expect(res.answer.trim().toLowerCase()).toBe('cat');
  });
});


