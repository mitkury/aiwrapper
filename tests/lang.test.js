import { describe, it, expect, beforeAll } from 'vitest';
import { Lang, LangChatMessageCollection } from '../dist/index.js';

// Skip tests if no API key is available
const apiKey = process.env.OPENAI_API_KEY;
const runTests = apiKey !== undefined;

describe('Lang API', () => {
  beforeAll(() => {
    if (!runTests) {
      console.warn('Skipping tests: No OpenAI API key found in .env file');
    }
  });

  it('should initialize OpenAI provider', () => {
    if (!runTests) return;
    
    const lang = Lang.openai({ apiKey });
    expect(lang).toBeDefined();
  });

  it('should generate text with ask method', async () => {
    if (!runTests) return;
    
    const lang = Lang.openai({ apiKey });
    const result = await lang.ask('Say hi!');
    
    expect(result).toBeDefined();
    expect(result.answer).toBeDefined();
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it('should handle chat messages', async () => {
    if (!runTests) return;
    
    const lang = Lang.openai({ apiKey });
    const messages = new LangChatMessageCollection();
    
    messages.addSystemMessage('You are a helpful assistant.');
    messages.addUserMessage('Tell me about JavaScript.');
    
    const result = await lang.chat(messages);
    
    expect(result).toBeDefined();
    expect(result.answer).toBeDefined();
    expect(result.answer.length).toBeGreaterThan(0);
  });
});
