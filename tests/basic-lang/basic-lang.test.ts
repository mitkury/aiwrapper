import { describe, it, expect } from 'vitest';
import { Lang, LangMessages, LangOptions } from '../../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('Basic Lang', () => {
  const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY as string, model: 'gpt-5-nano' });

  // @TODO: streaming WITH tools
  // @TODO: streaming plain messages but make sure the incoming chars are streaming correctly (sum of the chars should be the same as the answer)

  async function testUsingTools(stream: boolean) {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Give me a random number'
      }
    ], {
      tools: [
        {
          name: 'get_random_number',
          description: 'Return a random number',
          parameters: { type: 'object', properties: {} },
          handler: () => 3131
        }
      ]
    });

    const options: LangOptions = stream ? { onResult: (res: LangMessages) => { 
      console.log(res.answer);
    } } : {};

    const res = await lang.chat(messages, options);

    expect(res.requestedToolUse?.length).toBeGreaterThan(0);
    const tool = res.requestedToolUse?.[0];
    expect(tool?.name).toBe('get_random_number');

    // Execute requested tools and continue the chat automatically
    await res.executeRequestedTools();

    // After execution, there should be a tool message and a continued answer
    const hasToolMessage = res.some(m => m.role === 'tool');
    expect(hasToolMessage).toBe(true);
    expect(typeof res.answer).toBe('string');

    const toolResults = res.filter(m => m.role === 'tool-results');
    expect(toolResults.length).toBeGreaterThan(0);
    expect(toolResults[0].content).toBeDefined();
    const firstResult = toolResults[0].content?.[0];
    expect(firstResult?.result).toBe(3131);

    // Send the result back to the model
    await lang.chat(messages, options);

    // Expect the answer to contain the tool result
    expect(res.answer).toContain('3131');
  }

  it('should be able to use tools (non-streaming)', async () => {
    await testUsingTools(false);
  });

  it('should be able to use tools (streaming)', async () => {
    await testUsingTools(true);
  });

  it('should respond with a string', async () => {
    const res = await lang.ask('Hey, respond with "Hey" as well');
    expect(typeof res.answer).toBe('string');
  });

  it('should know the capital of France', async () => {
    const res = await lang.ask('What is the capital of France?');
    expect(res.answer.toLocaleLowerCase()).toContain('paris');
  });

  it('should be able to stream an answer', async () => {
    let streamingAnswers: string[] = [];
    const res = await lang.ask('Introduce yourself in 140 characters', {
      onResult: (msgs) => {
        streamingAnswers.push(msgs.answer);
      }
    });
    expect(streamingAnswers.length).toBeGreaterThan(0);
    const lastAnswer = streamingAnswers[streamingAnswers.length - 1];
    expect(streamingAnswers[streamingAnswers.length - 1].length).toBeGreaterThan(100);

    expect(res.answer.length).toBeGreaterThan(100);
    expect(res.answer).toBe(lastAnswer);
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
