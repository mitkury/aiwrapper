import { describe, it, expect, assert } from 'vitest';
import { LangMessage, LangMessages, LangOptions, LanguageProvider, ToolRequest, ToolResult, z } from 'aiwrapper';
import { createLangTestRunner, printAvailableProviders } from '../utils/lang-gatherer.js';
import { LangMessageItemTool, LangMessageItemToolResult } from 'src/lang/messages.js';

// Show available providers for debugging
printAvailableProviders();

describe('Basic Lang', () => {
  createLangTestRunner(runTest);
});

async function runTest(lang: LanguageProvider) {

  /*
  it('should respond with a string', async () => {
    const res = await lang.ask('Hey, respond with "Hey" as well');
    expect(res.length).toBeGreaterThan(1);

    const lastMessage = res[res.length - 1];
    expect(lastMessage.role).toBe('assistant');
    assert(lastMessage.text.length > 0);
    assert(res.answer.length > 0);
  });


  it('should know the capital of France', async () => {
    const res = await lang.ask('What is the capital of France?');
    expect(res.answer.toLocaleLowerCase()).toContain('paris');
  });

  it('should be able to stream an answer', async () => {
    let streamingAnswer: string[] = [];
    const res = await lang.ask('Introduce yourself in 140 characters', {
      onResult: (msg) => {
        streamingAnswer.push(msg.text);
      }
    });

    expect(streamingAnswer.length).toBeGreaterThan(0);

    const lastAnswer = streamingAnswer[streamingAnswer.length - 1];
    expect(lastAnswer.length).toBeGreaterThan(70);
    expect(res.answer).toBe(lastAnswer);
  });

  it('should be able to chat', async () => {
    const messages = new LangMessages();
    messages.addUserMessage('Hey, respond with "Hey" as well');
    messages.addAssistantMessage('Hey');
    messages.addUserMessage('What is the capital of France?');

    const res = await lang.chat(messages);
    expect(typeof res.answer).toBe('string');
    expect(res.answer.toLocaleLowerCase()).toContain('paris');
  });
  */

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
    const messages = new LangMessages();
    messages.addUserMessage('Give me a random number');
    messages.availableTools = [
      {
        name: 'get_random_number',
        description: 'Return a random number',
        parameters: { type: 'object', properties: {} },
        handler: () => 3131
      }
    ];
    const res = await lang.chat(messages);

    // After execution, check the last two messages should be tool request and tool results
    expect(res.length).toBeGreaterThanOrEqual(3); // user message + tool message + tool-results message

    const lastMessage = res[res.length - 1];
    const secondLastMessage = res[res.length - 2];

    // Last message should be tool-results
    expect(lastMessage.role).toBe('tool-results');
    const toolResult = lastMessage.toolResults[0];
    expect(toolResult.callId).toBeDefined();
    expect(toolResult.result).toBe(3131);

    // Second to last message should be tool request
    expect(secondLastMessage.role).toBe('assistant');
    const toolCall = secondLastMessage.toolRequests[0];
    expect(toolCall.callId).toBeDefined();
    expect(toolCall.name).toBe('get_random_number');
    expect(toolCall.arguments).toBeDefined();

    // Send the conversation back to the model to get the final response
    const finalRes = await lang.chat(res);

    // Expect the final answer to contain the tool result
    expect(finalRes.answer).toContain('3131');
    expect(finalRes[finalRes.length - 1].role).toBe('assistant');
  });

  it('should be able to chat and use tools', async () => {
    let streamedMessage: LangMessage | null = null;

    const messages = new LangMessages();
    messages.addUserMessage('Hey');
    const res1 = await lang.chat(messages, {
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
        if (msg.role === 'tool-results' && msg.toolResults.length > 0) {
          streamedMessageWithToolResults = msg;
        }
      }
    });

    expect(streamedMessageWithToolRequest).toBeDefined();
    expect(streamedMessageWithToolResults).toBeDefined();

    expect(res2[res2.length - 1].role).toBe(streamedMessageWithToolResults!.role);
    expect(res2[res2.length - 1].text).toBe(streamedMessageWithToolResults!.text);
  });
  
}
