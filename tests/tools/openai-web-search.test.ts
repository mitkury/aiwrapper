import { describe, it, expect, assert } from 'vitest';
import { Lang, LangMessages, ToolResult } from 'aiwrapper';

const apiKey = process.env.OPENAI_API_KEY;

describe.skipIf(!apiKey)('OpenAI built-in Web Search Tool', () => {
  it('should use web_search tool', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-4o' });

    const messages = new LangMessages('What is the current weather in Paris in celsius? If you find the information, start with "The current weather in Paris" and if not - "I couldn\'t find the information"', {
      tools: [{ name: 'web_search' }]
    });

    const res = await lang.chat(messages);

    expect(res.answer).toBeDefined();
    expect(res.answer.toLocaleLowerCase()).toContain('the current weather in paris');
    expect(res.finished).toBe(true);
  });
});

