import { describe, it, expect } from 'vitest';
import { Lang, z } from '../dist/index.js';

describe('Structured output with Zod and JSON Schema using Mock OpenAI', () => {
  it('validates Zod schema and populates result.object', async () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int().nonnegative(),
    });

    const mock = Lang.mockOpenAI({
      mockResponseObject: { name: 'Alice', age: 30 },
    });

    const res = await mock.askForObject('Return user', schema);
    expect(res.object).toEqual({ name: 'Alice', age: 30 });
    expect(res.validationErrors).toEqual([]);
    expect(typeof res.answer).toBe('string');
    expect(res.answer.length).toBeGreaterThan(0);
  });

  it('reports validation errors for invalid Zod object', async () => {
    const schema = z.object({ id: z.string().uuid() });

    const mock = Lang.mockOpenAI({
      mockResponseObject: { id: 'not-a-uuid' },
    });

    const res = await mock.askForObject('Return id', schema);
    expect(res.object).toBeNull();
    expect(res.validationErrors.length).toBeGreaterThan(0);
  });

  it('validates JSON Schema too', async () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        pages: { type: 'integer', minimum: 1 }
      },
      required: ['title', 'pages'],
      additionalProperties: false
    };

    const mock = Lang.mockOpenAI({
      mockResponseObject: { title: 'Book', pages: 120 },
    });

    const res = await mock.askForObject('Return book', jsonSchema);
    expect(res.object).toEqual({ title: 'Book', pages: 120 });
    expect(res.validationErrors).toEqual([]);
  });
});