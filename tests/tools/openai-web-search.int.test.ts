import { describe, it, expect } from 'vitest';
import { Lang, LangMessages } from '../../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('OpenAI Web Search Tool (integration)', () => {
  it('should use web_search tool for recent information', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-4o' });

    const messages = new LangMessages('What is the current weather in Paris?', {
      tools: [{ name: 'web_search' }]
    });

    const res = await lang.chat(messages);

    expect(res.answer).toBeDefined();
    expect(res.answer.length).toBeGreaterThan(0);
    expect(res.finished).toBe(true);
  });

  it('should use web_search tool with streaming', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-4o' });

    let streamingAnswer = '';
    const messages = new LangMessages('What is the current weather in Paris?', {
      tools: [{ name: 'web_search' }]
    });

    const res = await lang.chat(messages, {
      onResult: (result) => {
        streamingAnswer = result.answer;
      }
    });

    expect(res.answer.length).toBeGreaterThan(0);
    expect(streamingAnswer).toBe(res.answer);
  });
});

