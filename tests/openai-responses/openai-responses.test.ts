import { describe, it, expect } from 'vitest';
import { Lang, LangMessages, LangOptions } from '../../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('OpenAI Responses', () => {
  const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY as string, model: 'gpt-5-nano' });
  
  it('should handle back-and-forth conversation with previous_response_id optimization and fallback', async () => {
    // Step 1: Initial conversation
    console.log('Step 1: Initial conversation');
    const messages1 = new LangMessages([
      { role: 'user', content: 'hey' }
    ]);
    
    const result1 = await lang.chat(messages1);
    expect(result1.answer).toBeDefined();
    expect(result1[1].meta?.openaiResponseId).toBeDefined();
    
    // Step 2: Continue conversation (should use previous_response_id optimization)
    const messages2 = new LangMessages([
      ...result1,
      { role: 'user', content: 'my name is Alex' }
    ]);
    
    const result2 = await lang.chat(messages2);
    expect(result2.answer).toBeDefined();
    expect(result2.answer.toLowerCase()).toContain('alex');
    
    // Step 3: Test fallback with invalid response ID
    console.log('Step 3: Test fallback with invalid response ID');
    const invalidResponseId = 'resp_invalid_id_that_does_not_exist';
    const messages3 = new LangMessages([
      { role: 'user', content: 'hey' },
      { 
        role: 'assistant', 
        content: result1.answer,
        meta: { openaiResponseId: invalidResponseId }
      },
      { role: 'user', content: 'my name is Alex' },
      { 
        role: 'assistant', 
        content: result2.answer,
        meta: { openaiResponseId: invalidResponseId }
      },
      { role: 'user', content: 'nice to meet you' }
    ]);
    
    // This should fallback to full input and work correctly
    const result3 = await lang.chat(messages3);
    expect(result3.answer).toBeDefined();
    expect(typeof result3.answer).toBe('string');
    expect(result3.answer.length).toBeGreaterThan(0);
    
    // Verify the conversation flow worked
    expect(result1.answer).toBeDefined();
    expect(result2.answer).toBeDefined();
    expect(result3.answer).toBeDefined();
  });
  
});