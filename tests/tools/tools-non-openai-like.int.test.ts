import { describe, it, expect } from 'vitest';
import { Lang } from '../../dist/index.js';

type Case = {
  provider: string;
  envKey: string;
  create: (apiKey: string) => any;
};

const cases: Case[] = [
  {
    provider: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    create: (apiKey: string) => Lang.anthropic({ apiKey, model: process.env.ANTHROPIC_MODEL || undefined as any }),
  },
  {
    provider: 'Google',
    envKey: 'GOOGLE_API_KEY',
    create: (apiKey: string) => Lang.google({ apiKey, model: process.env.GOOGLE_MODEL || undefined as any }),
  },
  {
    provider: 'Cohere',
    envKey: 'COHERE_API_KEY',
    create: (apiKey: string) => Lang.cohere({ apiKey, model: process.env.COHERE_MODEL || undefined as any }),
  },
];

async function runToolCall(lang: any) {
  const result = await lang.chat(
    [
      {
        role: 'user',
        content: 'Use the get_weather tool to fetch the weather for Boston in celsius. Only call the tool.'
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
  return result;
}

describe('Non-OpenAI-compatible tool calling (integration)', () => {
  const allow = (process.env.RUN_NON_OPENAI_LIKE_TOOLS === '1' || process.env.RUN_NON_OPENAI_LIKE_TOOLS === 'true');
  for (const c of cases) {
    const apiKey = process.env[c.envKey];
    const shouldRun = !!apiKey && allow;
    const testName = `${c.provider} returns tool call with arguments`;

    (shouldRun ? it : it.skip)(testName, async () => {
      const lang = c.create(apiKey as string);
      const result = await runToolCall(lang);

      expect(result.tools).toBeDefined();
      expect(result.tools!.length).toBeGreaterThan(0);
      expect(result.tools![0].name).toBe('get_weather');
      const args = result.tools![0].arguments as any;
      expect(String(args.location || '').toLowerCase()).toContain('boston');
    }, 60000);
  }
});


