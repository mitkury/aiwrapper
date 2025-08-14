import { describe, it, expect, beforeAll } from 'vitest';
import { Lang, z } from '../../dist/index.js';

// Requires OPENAI_API_KEY and internet access

const apiKey = process.env.OPENAI_API_KEY;
const runTests = apiKey !== undefined;

describe('Structured output with OpenAI (integration)', () => {
  beforeAll(() => {
    if (!runTests) {
      console.warn('Skipping OpenAI structured output test: OPENAI_API_KEY not set');
    }
  });

  it('validates returned object against schema', async () => {
    if (!runTests) return;

    const lang = Lang.openai({ apiKey });
    const schema = z.object({
      name: z.string(),
      age: z.number().int().nonnegative(),
    });

    const res = await lang.askForObject('Give a random person name and age', schema);

    expect(res.object).not.toBeNull();
    expect(res.validationErrors).toEqual([]);
  });
});

