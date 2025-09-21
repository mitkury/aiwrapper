import { describe, it, expect } from 'vitest';
import { LangMessages, LangOptions, LanguageProvider } from '../../dist/index.js';
import { createLangTestRunner } from '../utils/lang-gatherer.js';

describe('Basic Lang', () => {
  createLangTestRunner(runTest, {
    includeOpenRouter: false, // Exclude OpenRouter due to billing issues (402 errors)
    includeDeepSeek: false    // Exclude DeepSeek due to tool role mapping issues
  });
});

async function runTest(lang: LanguageProvider) {
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

    const res = await lang.chat(messages);

    // After execution, check the last two messages should be tool request and tool results
    expect(res.length).toBeGreaterThanOrEqual(3); // user message + tool message + tool-results message

    const lastMessage = res[res.length - 1];
    const secondLastMessage = res[res.length - 2];

    // Last message should be tool-results
    expect(lastMessage.role).toBe('tool-results');
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const toolResult = lastMessage.content[0];
    expect(toolResult.toolId).toBeDefined();
    expect(toolResult.result).toBe(3131);

    // Second to last message should be tool request
    expect(secondLastMessage.role).toBe('tool');
    expect(Array.isArray(secondLastMessage.content)).toBe(true);
    const toolCall = secondLastMessage.content[0];
    expect(toolCall.callId).toBeDefined();
    expect(toolCall.name).toBe('get_random_number');
    expect(toolCall.arguments).toBeDefined();

    let streamingAnswer: string = '';
    const options: LangOptions = stream ? {
      onResult: (res: LangMessages) => {
        streamingAnswer = res.answer;
      }
    } : {};

    // Send the conversation back to the model to get the final response
    const finalRes = await lang.chat(res, options);

    // Expect the final answer to contain the tool result
    expect(finalRes.answer).toContain('3131');

    if (stream) {
      expect(streamingAnswer).toBe(finalRes.answer);
    }
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
}
