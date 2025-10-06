import { describe, it, expect } from 'vitest';
import { Lang } from '../../dist/index.js';
import { ChatAgent } from '../../src/agents/ChatAgent.js';

// Test configuration - easily switch providers
const TEST_CONFIG = {
  // Primary provider for testing
  primaryProvider: 'openrouter' as const,
  
  // Alternative providers to test (optional)
  alternativeProviders: ['anthropic', 'openai'] as const,
  
  // OpenRouter model
  openrouterModel: 'anthropic/claude-3.5-sonnet',
  
  // Test with specific providers only (uncomment to use specific providers)
  // providers: ['openrouter'] as const,
} as const;

describe('ChatAgent', () => {
  // Helper function to create test runner
  function createChatAgentTestRunner(testFn: (agent: ChatAgent, providerName: string) => Promise<void>) {
    const providers = (TEST_CONFIG as any).providers || [TEST_CONFIG.primaryProvider, ...TEST_CONFIG.alternativeProviders];
    
    for (const providerName of providers) {
      it(`should work with ${providerName}`, async () => {
        const lang = createLangProvider(providerName);
        const agent = new ChatAgent(lang);
        await testFn(agent, providerName);
      });
    }
  }

  // Helper to create language provider
  function createLangProvider(providerName: string) {
    switch (providerName) {
      case 'openrouter':
        return Lang.openrouter({ 
          apiKey: process.env.OPENROUTER_API_KEY!,
          model: TEST_CONFIG.openrouterModel
        });
      case 'anthropic':
        return Lang.anthropic({ 
          apiKey: process.env.ANTHROPIC_API_KEY!,
          model: 'claude-3-5-sonnet-20241022'
        });
      case 'openai':
        return Lang.openai({ 
          apiKey: process.env.OPENAI_API_KEY!,
          model: 'gpt-4o-mini'
        });
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  // Run tests
  createChatAgentTestRunner(async (agent, providerName) => {
    await testSingleMessage(agent, providerName);
  });

  createChatAgentTestRunner(async (agent, providerName) => {
    await testMessageArray(agent, providerName);
  });

  createChatAgentTestRunner(async (agent, providerName) => {
    await testConversationFlow(agent, providerName);
  });

  createChatAgentTestRunner(async (agent, providerName) => {
    await testEventSubscription(agent, providerName);
  });
});

async function testSingleMessage(agent: ChatAgent, providerName: string) {
  console.log(`Testing single message with ${providerName}`);
  
  const result = await agent.run({
    role: 'user',
    content: 'Say "Hello from ChatAgent!" and nothing else.'
  });

  expect(result).toBeDefined();
  expect(result!.answer).toContain('Hello from ChatAgent');
  expect(result!.messages.length).toBeGreaterThanOrEqual(2); // user + assistant
  
  console.log(`✅ Single message test passed for ${providerName}`);
}

async function testMessageArray(agent: ChatAgent, providerName: string) {
  console.log(`Testing message array with ${providerName}`);
  
  const result = await agent.run([
    { role: 'user', content: 'What is 2+2?' },
    { role: 'assistant', content: '2+2 equals 4.' },
    { role: 'user', content: 'What is 4+4 then?' }
  ]);

  expect(result).toBeDefined();
  expect(result!.answer).toContain('8');
  expect(result!.messages.length).toBeGreaterThanOrEqual(4); // 3 input + assistant response
  
  console.log(`✅ Message array test passed for ${providerName}`);
}

async function testConversationFlow(agent: ChatAgent, providerName: string) {
  console.log(`Testing conversation flow with ${providerName}`);
  
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
  
  console.log(`✅ Conversation flow test passed for ${providerName}`);
}

async function testEventSubscription(agent: ChatAgent, providerName: string) {
  console.log(`Testing event subscription with ${providerName}`);
  
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
  
  console.log(`✅ Event subscription test passed for ${providerName}`);
}
