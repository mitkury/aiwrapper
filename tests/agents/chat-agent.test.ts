import { describe, it, expect } from 'vitest';
import { LanguageProvider, ChatAgent } from '../../dist/index.js';
import { createLangTestRunner } from '../utils/lang-gatherer.js';

describe('ChatAgent', () => {
  createLangTestRunner(runTest, { providers: ['anthropic', 'openrouter', 'openai'] });
});

async function runTest(lang: LanguageProvider) {
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

  it('should handle multiple sequential tool calls', async () => {
    console.log('Testing multiple sequential tool calls');

    // Here we have a task that specifically asks to use all 3 provided tools. We expect the agent
    // to use those tools without breaking the agentic loop before finishing the task.
    // We are not testing how smart the agent is but rather whether it can use multiple tools in a loop.
    const task = `Provide and summarize the current bug report status. To do that: 
1. Send an email to dev-team@company.com asking for the current status (keep it simple, just ask for the status)
2. Wait for their status update with the wait_for_response tool
3. Read the bug tracking URL they provide and summarize the current status here. 

Make sure you use all 3 provided tools.`;

    const agent = new ChatAgent(lang, {
      tools: [
        {
          name: 'send_email',
          description: 'Send an email to a recipient with a subject and message',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Email recipient' },
              subject: { type: 'string', description: 'Email subject line' },
              message: { type: 'string', description: 'Email message content' }
            },
            required: ['to', 'subject', 'message']
          },
          handler: (args: any) => ({
            email_id: 'email_0',
            status: 'sent',
            to: args.to,
            subject: args.subject,
            timestamp: new Date().toISOString()
          })
        },
        {
          name: 'wait_for_response',
          description: 'Wait for and retrieve a response to a previously sent email',
          parameters: {
            type: 'object',
            properties: {
              email_id: { type: 'string', description: 'ID of the email to wait for response to' }
            },
            required: ['email_id']
          },
          handler: (args: any) => ({
            email_id: args.email_id,
            response_received: true,
            from: 'dev-team@company.com',
            subject: 'Re: Critical Bug Report - BUG-2024-001',
            message: 'We have investigated the issue. Please check the bug tracking system: https://bugs.company.com/BUG-2024-001',
            timestamp: new Date().toISOString()
          })
        },
        {
          name: 'read_url',
          description: 'Read and parse content from a URL',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to read content from' }
            },
            required: ['url']
          },
          handler: (args: any) => {
            if (args.url?.toLowerCase().includes('bugs.company.com/bug-2024-001')) {
              return {
                url: args.url,
                title: 'Bug Report BUG-2024-001',
                status: 'In Progress',
                priority: 'Critical',
                assigned_to: 'John Smith',
                description: 'Database connection timeout causing 500 errors',
                last_updated: '2024-01-15T14:30:00Z',
                estimated_resolution: '2024-01-16T10:00:00Z'
              };
            }
            return {
              url: args.url,
              title: 'Page not found (404)',
              content: 'The page you are looking for does not exist',
              timestamp: new Date().toISOString()
            };
          }
        }
      ]
    });

    const result = await agent.run({
      role: 'user',
      content: task
    });

    expect(result).toBeDefined();

    // Check conversation for multiple tool calls
    const conversation = agent.getConversation();
    console.log(`Conversation length: ${conversation.length}`);
    console.log(`Final answer: "${result!.answer}"`);

    // Count tool result messages
    const toolResultMessages = conversation.filter(msg => msg.role === 'tool-results');
    console.log(`Tool result messages: ${toolResultMessages.length}`);

    // Should have multiple tool calls (at least 3 for send_email, wait_for_response, read_url)
    expect(toolResultMessages.length).toBeGreaterThanOrEqual(3);

    // Verify the answer contains information from the final tool call
    expect(result!.answer.toLowerCase()).toMatch(/in progress|critical|john smith|database|timeout/i);

    console.log('✅ Multiple sequential tool calls test passed');
  });
}

