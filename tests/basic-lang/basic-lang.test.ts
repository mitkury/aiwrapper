import { describe, it, expect } from 'vitest';
import { Lang } from '../../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('Basic Lang', () => {
  const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY as string, model: 'gpt-5-nano' });

  it('should respond with a string', async () => {
    const res = await lang.ask('Hey, respond with "Hey" as well');
    expect(typeof res.answer).toBe('string');
  });

  it('should be able to chat', async () => {
    const res = await lang.chat([
      { role: 'user', content: 'Hey, respond with "Hey" as well' },
      { role: 'assistant', content: 'Hey' },
      { role: 'user', content: 'What is the capital of France?' }
    ]);
    expect(typeof res.answer).toBe('string');
  });

  it('should know the capital of France', async () => {
    const res = await lang.ask('What is the capital of France?');
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
