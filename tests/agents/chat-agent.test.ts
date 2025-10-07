import { describe, it, expect } from 'vitest';
import { LanguageProvider, ChatAgent } from '../../dist/index.js';
import { createLangTestRunner, printAvailableProviders } from '../utils/lang-gatherer.js';

// Show available providers for debugging
//printAvailableProviders({ providers: ['openai'] });

describe('ChatAgent', () => {
  createLangTestRunner(runTest, { providers: ['openrouter'] });
});

async function runTest(lang: LanguageProvider) {
  /*
  it('should handle single message', async () => {
    console.log('Testing single message');
    
    const agent = new ChatAgent(lang);
    const result = await agent.run({
      role: 'user',
      content: 'Say "Hello from ChatAgent!" and nothing else.'
    });

    expect(result).toBeDefined();
    expect(result!.answer).toContain('Hello from ChatAgent');
    expect(result!.messages.length).toBeGreaterThanOrEqual(2); // user + assistant
    
    console.log('✅ Single message test passed');
  });

  it('should handle message array', async () => {
    console.log('Testing message array');
    
    const agent = new ChatAgent(lang);
    const result = await agent.run([
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '2+2 equals 4.' },
      { role: 'user', content: 'What is 4+4 then?' }
    ]);

    expect(result).toBeDefined();
    expect(result!.answer).toContain('8');
    expect(result!.messages.length).toBeGreaterThanOrEqual(4); // 3 input + assistant response
    
    console.log('✅ Message array test passed');
  });

  it('should handle conversation flow', async () => {
    console.log('Testing conversation flow');
    
    const agent = new ChatAgent(lang);
    
    // Start conversation
    agent.input({ role: 'user', content: 'My name is Alice.' });
    const result1 = await agent.run();
    
    expect(result1).toBeDefined();
    expect(result1!.answer).toContain('Alice');
    
    // Continue conversation
    const result2 = await agent.run({ role: 'user', content: 'What is my name?' });
    
    expect(result2).toBeDefined();
    expect(result2!.answer).toContain('Alice');
    
    // Check conversation history is maintained
    const conversation = agent.getConversation();
    expect(conversation.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant messages
    
    console.log('✅ Conversation flow test passed');
  });

  it('should handle event subscription', async () => {
    console.log('Testing event subscription');
    
    const agent = new ChatAgent(lang);
    const events: any[] = [];
    const unsubscribe = agent.subscribe(event => {
      events.push(event);
    });

    // Test state changes and events
    expect(agent.state).toBe('idle');
    
    // Use agent.input() first to trigger input event, then run()
    agent.input({
      role: 'user',
      content: 'Say "Events working!" and nothing else.'
    });
    
    const result = await agent.run();

    // Should have received events
    expect(events.length).toBeGreaterThan(0);
    
    // Should have state change events
    const stateEvents = events.filter(e => e.type === 'state');
    expect(stateEvents.length).toBeGreaterThan(0);
    
    // Should have input event
    const inputEvents = events.filter(e => e.type === 'input');
    expect(inputEvents.length).toBeGreaterThan(0);
    
    // Should have finished event
    const finishedEvents = events.filter(e => e.type === 'finished');
    expect(finishedEvents.length).toBeGreaterThan(0);
    
    // Final state should be idle
    expect(agent.state).toBe('idle');
    
    unsubscribe();
    
    console.log('✅ Event subscription test passed');
  });
  */

  it('should handle tool calling', async () => {
    console.log('Testing tool calling');

    const agent = new ChatAgent(lang, {
      tools: [
        {
          name: 'get_random_number',
          description: 'Return a random number',
          parameters: { type: 'object', properties: {} },
          handler: () => 3131
        }
      ]
    });

    const result = await agent.run({
      role: 'user',
      content: 'Give me a random number using a tool'
    });

    expect(result).toBeDefined();

    // Check that tool calls and results were added to conversation
    const conversation = agent.getConversation();
    console.log(`Conversation length: ${conversation.length}`);
    console.log(`Final answer: "${result!.answer}"`);

    const hasToolResult = conversation.some(msg =>
      msg.role === 'tool-results'
    );

    expect(hasToolResult).toBe(true);

    expect(result!.answer).toContain('3131');

    console.log('✅ Tool calling test passed - tool was used correctly');
  });
}

