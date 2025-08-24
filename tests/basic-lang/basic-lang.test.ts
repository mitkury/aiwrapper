import { describe, it, expect } from 'vitest';
import { Lang, LangMessages } from '../../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('Basic Lang', () => {
  const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY as string, model: 'gpt-5-nano' });

  it('should be able to use tools', async () => {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Give me a random number'
      }
    ], {
      tools: {
        get_random_number: {
          description: 'Return a random number',
          parameters: { type: 'object', properties: {} },
          handler: () => Math.floor(Math.random() * 100)
        }
      }
    });

    const res = await lang.chat(messages);

    expect(res.requestedToolUse?.length).toBeGreaterThan(0);
    const tool = res.requestedToolUse?.[0];
    expect(tool?.name).toBe('get_random_number');

    // Execute requested tools and continue the chat automatically
    await res.executeRequestedTools();

    // After execution, there should be a tool message and a continued answer
    const hasToolMessage = res.some(m => m.role === 'tool');
    expect(hasToolMessage).toBe(true);
    expect(typeof res.answer).toBe('string');

    // @TODO: check tool results 
    const toolResults = res.filter(m => m.role === 'tool-results');
    expect(toolResults.length).toBeGreaterThan(0);
    expect(toolResults[0].content).toBeDefined();
  });

  it('should respond with a string', async () => {
    const res = await lang.ask('Hey, respond with "Hey" as well');
    expect(typeof res.answer).toBe('string');
  });

  it('should know the capital of France', async () => {
    const res = await lang.ask('What is the capital of France?');
    expect(res.answer.toLocaleLowerCase()).toContain('paris');
  });

  it('should be able to chat', async () => {
    const res = await lang.chat([
      { role: 'user', content: 'Hey, respond with "Hey" as well' },
      { role: 'assistant', content: 'Hey' },
      { role: 'user', content: 'What is the capital of France?' }
    ]);
    expect(typeof res.answer).toBe('string');
    expect(res.answer.toLocaleLowerCase()).toContain('paris');
  });

  it('should return a JSON object', async () => {
    const res = await lang.askForObject('Return a JSON object with a "name" property', {
      name: 'string',
    });
    expect(typeof res.object).toBe('object');
    expect(res.object?.name).toBeDefined();
  });
});
