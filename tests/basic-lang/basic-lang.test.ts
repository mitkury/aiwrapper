import { describe, it, expect, assert } from 'vitest';
import { LangMessage, LangMessages, LangOptions, LanguageProvider, ToolRequest, ToolResult } from 'aiwrapper';
import { createLangTestRunner, printAvailableProviders } from '../utils/lang-gatherer.js';

// Show available providers for debugging
printAvailableProviders();

describe('Basic Lang', () => {
  createLangTestRunner(runTest);
});

async function runTest(lang: LanguageProvider) {
  it('should respond with a string', async () => {
    const res = await lang.ask('Hey, respond with "Hey" as well');
    expect(res.length).toBeGreaterThan(1);

    const lastMessage = res[res.length - 1];
    expect(lastMessage.role).toBe('assistant');
    assert(lastMessage.content.length > 0);
    assert(res.answer.length > 0);
  });

  it('should know the capital of France', async () => {
    const res = await lang.ask('What is the capital of France?');
    expect(res.answer.toLocaleLowerCase()).toContain('paris');
  });

  it('should be able to stream an answer', async () => {
    let streamingAnswers: string[] = [];
    const res = await lang.ask('Introduce yourself in 140 characters', {
      onResult: (msg: any) => {
        if (msg && typeof msg.content === 'string') {
          streamingAnswers.push(msg.content);
        }
      }
    });
    expect(streamingAnswers.length).toBeGreaterThan(0);
    const lastAnswer = streamingAnswers[streamingAnswers.length - 1];
    expect(lastAnswer.length).toBeGreaterThan(70);
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

  it('should follow instructions', async () => {
    const messages = new LangMessages();
    messages.addUserMessage('What is the capital of France?');
    messages.instructions = 'The first word of your respond MUST be "GOT IT"';
    const res = await lang.chat(messages);
    expect(res.answer.toLocaleLowerCase()).toContain('got it');
  });

  it('should be able to use a tool', async () => {
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
    const toolResult = lastMessage.content[0] as ToolResult;
    expect(toolResult.toolId).toBeDefined();
    expect(toolResult.result).toBe(3131);

    // Second to last message should be tool request
    expect(secondLastMessage.role).toBe('tool');
    expect(Array.isArray(secondLastMessage.content)).toBe(true);
    const toolCall = secondLastMessage.content[0] as ToolRequest;
    expect(toolCall.callId).toBeDefined();
    expect(toolCall.name).toBe('get_random_number');
    expect(toolCall.arguments).toBeDefined();

    // Send the conversation back to the model to get the final response
    const finalRes = await lang.chat(res);

    // Expect the final answer to contain the tool result
    expect(finalRes.answer).toContain('3131');
  });

  it('should be able to chat and use tools', async () => {

    let streamedMessage: LangMessage | null = null;

    const res1 = await lang.chat([
      { role: 'user', content: 'Hey' }
    ], {
      onResult: (msg) => {
        streamedMessage = msg;
      }
    });

    expect(res1.length).toBe(2);
    expect(streamedMessage).toBeDefined();

    expect(res1[res1.length - 1].role).toBe(streamedMessage!.role);
    expect(res1[res1.length - 1].content).toBe(streamedMessage!.content);

    res1.addUserMessage('Give me a random number using a tool');
    res1.availableTools = [
      {
        name: 'get_random_number',
        description: 'Return a random number',
        parameters: { type: 'object', properties: {} },
        handler: () => 3131
      }
    ];

    let streamedMessageWithToolRequest: LangMessage | null = null;
    let streamedMessageWithToolResults: LangMessage | null = null;

    const res2 = await lang.chat(res1, {
      onResult: (msg) => {
        if (msg.role === 'tool') {
          streamedMessageWithToolRequest = msg;
        }
        if (msg.role === 'tool-results') {
          streamedMessageWithToolResults = msg;
        }
      }
    });

    expect(streamedMessageWithToolRequest).toBeDefined();
    expect(streamedMessageWithToolResults).toBeDefined();

    expect(res2[res2.length - 1].role).toBe(streamedMessageWithToolResults!.role);
    expect(res2[res2.length - 1].content).toBe(streamedMessageWithToolResults!.content);
  });
}
