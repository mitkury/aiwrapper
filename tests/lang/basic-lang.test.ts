import { describe, it, expect, assert } from 'vitest';
import { LangMessage, LangMessages, LangOptions, LanguageProvider, ToolRequest, ToolResult, z } from 'aiwrapper';
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
    expect(lastMessage.text.length).toBeGreaterThan(0);
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
        if (!msg) return;
        const text = msg.text;
        if (typeof text === 'string' && text.length > 0) {
          streamingAnswers.push(text);
        }
      }
    });
    if (streamingAnswers.length > 0) {
      const lastAnswer = streamingAnswers[streamingAnswers.length - 1];
      expect(lastAnswer.length).toBeGreaterThan(70);
      expect(res.answer).toBe(lastAnswer);
    } else {
      expect(res.answer.length).toBeGreaterThan(70);
    }
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

  it('should return a simple JSON object', async () => {

    const nameSchema = z.object({
      name: z.string(),
    });

    const res = await lang.askForObject('Return a JSON object with a "name" property', nameSchema);
    expect(typeof res.object).toBe('object');
    expect(res.object?.name).toBeDefined();
  });

  it('should return a more complex JSON without tips in the prompt', async () => {

    const schema = z.object({
      names: z.array(z.object({
        pitch: z.string(),
        reasoning: z.string(),
        name: z.string(),
      })),
    });

    const messages = new LangMessages();
    messages.instructions = "You're a naming consultant. When users ask for a name, give them at least 3 good names. Keep it short and punchy."
    messages.addUserMessage('What is a good name for a company that makes colorful socks?');

    const res = await lang.chat(messages, { schema });
    expect(typeof res.object).toBe('object');
    expect(res.object?.names.length).toBeGreaterThan(2);
    expect(res.object?.names[0].name.length).toBeGreaterThan(0);
    expect(res.object?.names[0].pitch.length).toBeGreaterThan(0);
    expect(res.object?.names[0].reasoning.length).toBeGreaterThan(0);
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

    const toolResultMessage = res.find(msg => msg.toolResults.length > 0);
    expect(toolResultMessage).toBeDefined();
    const toolResult = toolResultMessage!.toolResults[0] as ToolResult;
    expect(toolResult.toolId).toBeDefined();
    expect(toolResult.result).toBe(3131);

    const toolRequestMessage = res.find(msg => msg.toolRequests.length > 0);
    expect(toolRequestMessage).toBeDefined();
    const toolCall = toolRequestMessage!.toolRequests[0] as ToolRequest;
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
    expect(res1[res1.length - 1].text).toBe(streamedMessage!.text);

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
        if (msg.role === 'assistant' && msg.toolRequests.length > 0) {
          streamedMessageWithToolRequest = msg;
        }
        if (msg.toolResults.length > 0) {
          streamedMessageWithToolResults = msg;
        }
      }
    });

    expect(streamedMessageWithToolRequest).toBeDefined();
    expect(streamedMessageWithToolResults).toBeDefined();

    const res2ToolRequestMsg = res2.find(msg => msg.toolRequests.length > 0);
    expect(res2ToolRequestMsg).toBeDefined();
    const res2ToolResultMsg = res2.find(msg => msg.toolResults.length > 0);
    expect(res2ToolResultMsg).toBeDefined();

    if (streamedMessageWithToolRequest) {
      expect(streamedMessageWithToolRequest.toolRequests.length).toBeGreaterThan(0);
    }
    if (streamedMessageWithToolResults) {
      expect(streamedMessageWithToolResults.toolResults).toEqual(res2ToolResultMsg!.toolResults);
    }
  });
}
