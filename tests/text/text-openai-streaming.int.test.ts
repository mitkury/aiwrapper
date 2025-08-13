import { describe, it, expect } from 'vitest';
import { Lang } from '../../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('OpenAI streaming (integration)', () => {
  it('streams answer via onResult callback', async () => {
    // Prefer a commonly available streaming-capable model
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-4o' });
    let updates = 0;
    const res = await lang.ask('Say hello and then give me one fun fact.', {
      onResult: () => { updates++; }
    });
    expect(res.answer.length).toBeGreaterThan(0);
    expect(updates).toBeGreaterThan(0);
  });
});


