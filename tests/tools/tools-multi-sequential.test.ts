import { describe, it, expect } from 'vitest';
import { Lang, executeToolsAndContinue } from '../../dist/index.js';

// @TODO: re-write it for the new API

async function runSequentialScenario(provider: any) {
  const tools = [
    { name: 'get_random_number', description: 'Return a predefined random number', parameters: { type: 'object', properties: {} } },
    { name: 'get_random_word', description: 'Return a predefined random word', parameters: { type: 'object', properties: {} } },
    { name: 'get_random_color', description: 'Return a predefined random color', parameters: { type: 'object', properties: {} } }
  ];

  const registry = {
    get_random_number: () => 6931,
    get_random_word: () => 'nice',
    get_random_color: () => 'red'
  } as const;

  // Step 1: number
  if ((provider as any).mockConfig) {
    (provider as any).mockConfig.mockToolCalls = [ { name: 'get_random_number', argumentsChunks: ['{}'] } ];
  }
  let result = await provider.chat([
    { role: 'user', content: 'Use get_random_number tool. After tool result is available, reply with only that value.' }
  ], { tools });
  if (!result.tools || result.tools.length === 0) return { skipped: true };
  expect(result.tools?.[0]?.name).toBe('get_random_number');
  result = await executeToolsAndContinue(provider, result, registry as any);
  expect(result.answer).toContain('6931');

  // Step 2: word
  if ((provider as any).mockConfig) {
    (provider as any).mockConfig.mockToolCalls = [ { name: 'get_random_word', argumentsChunks: ['{}'] } ];
  }
  result.addUserMessage('Now use get_random_word tool and reply with only the value.');
  result = await provider.chat(result.messages, { tools });
  if (!result.tools || result.tools.length === 0) return { skipped: true };
  expect(result.tools?.[0]?.name).toBe('get_random_word');
  result = await executeToolsAndContinue(provider, result, registry as any);
  expect(result.answer).toContain('nice');

  // Step 3: color
  if ((provider as any).mockConfig) {
    (provider as any).mockConfig.mockToolCalls = [ { name: 'get_random_color', argumentsChunks: ['{}'] } ];
  }
  result.addUserMessage('Finally, use get_random_color tool and reply with only the value.');
  result = await provider.chat(result.messages, { tools });
  if (!result.tools || result.tools.length === 0) return { skipped: true };
  expect(result.tools?.[0]?.name).toBe('get_random_color');
  result = await executeToolsAndContinue(provider, result, registry as any);
  expect(result.answer).toContain('red');

  return { skipped: false };
}

describe('Sequential tool calls across a conversation (mock + OpenAI)', () => {
  it('runs with mock provider', async () => {
    const answers = ['6931', 'nice', 'red'];
    let idx = 0;
    const mock = Lang.mockOpenAI({
      mockResponseText: () => answers[Math.min(idx++, answers.length - 1)]
    });
    const out = await runSequentialScenario(mock);
    expect(out.skipped).toBe(false);
  });

  const apiKey = process.env.OPENAI_API_KEY;
  (apiKey ? it : it.skip)('runs with OpenAI provider', async () => {
    const openai = Lang.openai({ apiKey: apiKey as string, model: process.env.OPENAI_MODEL || undefined as any });
    const out = await runSequentialScenario(openai);
    // If a given model does not return function calls consistently, allow soft-skip
    if (out.skipped) {
      // no-op
      return;
    }
    expect(out.skipped).toBe(false);
  }, 20000);
});


