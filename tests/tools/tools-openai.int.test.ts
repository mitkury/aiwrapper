import { describe, it, expect, beforeAll } from 'vitest';
import { Lang } from '../../dist/index.js';

// Requires OPENAI_API_KEY and internet access

const apiKey = process.env.OPENAI_API_KEY;
const runTests = apiKey !== undefined;

describe('OpenAI tool calling (integration)', () => {
  beforeAll(() => {
    if (!runTests) {
      console.warn('Skipping OpenAI tool test: OPENAI_API_KEY not set');
    }
  });

  it('returns tool call with arguments', async () => {
    if (!runTests) return;

    const lang = Lang.openai({ apiKey });
    const result = await lang.chat(
      [
        {
          role: 'user',
          content:
            'Use the get_weather tool to fetch the weather for Boston in celsius. Only call the tool.'
        }
      ],
      {
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather by location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
                unit: { type: 'string', enum: ['c', 'f'] }
              },
              required: ['location']
            }
          }
        ]
      }
    );

    expect(result.tools).toBeDefined();
    expect(result.tools![0].name).toBe('get_weather');
    expect(result.tools![0].arguments.location.toLowerCase()).toContain('boston');
  });
});

