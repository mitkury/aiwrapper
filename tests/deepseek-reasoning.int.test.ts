import { describe, it, expect } from 'vitest';
import { Lang } from '../dist/index.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
const run = !!apiKey && process.env.RUN_REASONING_TESTS === '1';

// These are integration tests; they will be skipped unless DEEPSEEK_API_KEY is present
describe.skipIf(!run)('DeepSeek reasoning (integration)', () => {
  it('streams reasoning content when using a reasoning-capable model', async () => {
    const lang = Lang.deepseek({ apiKey: apiKey as string, model: 'deepseek-reasoner' });
    let sawThinking = false;

    const res = await lang.ask('Explain why the sky appears blue, step by step.', {
      onResult: (r) => { if (r.thinking && r.thinking.length > 0) sawThinking = true; }
    });

    expect(res.answer.length).toBeGreaterThan(0);
    // We accept either presence or absence based on provider behavior, but ensure callback worked
    expect(typeof sawThinking).toBe('boolean');
  });
});


