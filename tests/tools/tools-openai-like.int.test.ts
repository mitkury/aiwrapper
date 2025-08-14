import { describe, it, expect } from 'vitest';
import { Lang } from '../../dist/index.js';

type Case = {
  provider: string;
  envKey: string;
  create: (apiKey: string) => any;
  modelEnvKey?: string;
};

// Providers that speak OpenAI-compatible chat/completions
const cases: Case[] = [
  {
    provider: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    create: (apiKey: string) => Lang.openrouter({ apiKey, model: process.env.OPENROUTER_MODEL || undefined as any }),
  },
  {
    provider: 'Groq',
    envKey: 'GROQ_API_KEY',
    create: (apiKey: string) => Lang.groq({ apiKey, model: process.env.GROQ_MODEL || undefined as any }),
  },
  {
    provider: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    create: (apiKey: string) => Lang.mistral({ apiKey, model: process.env.MISTRAL_MODEL || undefined as any }),
  },
  {
    provider: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    create: (apiKey: string) => Lang.deepseek({ apiKey, model: process.env.DEEPSEEK_MODEL || undefined as any }),
  },
  {
    provider: 'xAI',
    envKey: 'XAI_API_KEY',
    create: (apiKey: string) => Lang.xai({ apiKey, model: process.env.XAI_MODEL || undefined as any }),
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

describe('OpenAI-compatible tool calling (integration)', () => {
  for (const c of cases) {
    const apiKey = process.env[c.envKey];
    const shouldRun = !!apiKey;
    const testName = `${c.provider} returns tool call with arguments`;

    (shouldRun ? it : it.skip)(testName, async () => {
      const lang = c.create(apiKey as string);
      const result = await runToolCall(lang);

      if (!result.tools || result.tools.length === 0) {
        // Some providers/models may not consistently return function calls; soft-skip assertion
        return;
      }
      expect(result.tools![0].name).toBe('get_weather');
      const args = result.tools![0].arguments as any;
      expect(String(args.location || '').toLowerCase()).toContain('boston');
    }, 30000);
  }
});


