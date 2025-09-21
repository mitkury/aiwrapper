import { describe, it, expect } from 'vitest';
import { LangMessages, LangOptions, LanguageProvider } from '../../dist/index.js';
import { createLangTestRunner } from '../utils/lang-gatherer.js';

describe('Reasoning Detection', () => {
  createLangTestRunner(runReasoningTests);
});

async function runReasoningTests(lang: LanguageProvider) {
  
  it('should detect reasoning when available and stream reasoning tokens', async () => {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Think deeply about this complex question: How might the rise of artificial intelligence fundamentally change the way we approach education, work, and human creativity in the next 20 years? Consider the implications from multiple perspectives - economic, social, psychological, and ethical. What are the potential benefits and risks, and how might society need to adapt? Please think through this step by step.'
      }
    ]);

    let reasoningDetected = false;
    let reasoningTokens: string[] = [];
    let streamingEvents = 0;

    const options: LangOptions = {
      onResult: (result) => {
        streamingEvents++;
        
        // Check if reasoning content is being streamed
        if (result.thinking) {
          reasoningDetected = true;
          reasoningTokens.push(result.thinking);
          console.log(`🧠 Reasoning token received (${lang.constructor.name}):`, result.thinking.length, 'chars');
        }
      }
    };

    const result = await lang.chat(messages, options);
    
    // Basic response validation
    expect(result.answer).toBeDefined();
    expect(result.finished).toBe(true);
    expect(result.answer.length).toBeGreaterThan(0);
    
    // Log results for visibility
    console.log(`\n📊 ${lang.constructor.name} Reasoning Results:`);
    console.log(`   Streaming events: ${streamingEvents}`);
    console.log(`   Reasoning detected: ${reasoningDetected ? '✅ Yes' : '❌ No'}`);
    console.log(`   Reasoning tokens: ${reasoningTokens.length}`);
    console.log(`   Final thinking: ${result.thinking ? 'Present' : 'Missing'}`);
    console.log(`   Final thinking length: ${result.thinking?.length || 0} characters`);
    
    if (result.thinking) {
      console.log(`   Reasoning preview: ${result.thinking.substring(0, 100)}...`);
    }
  });

  it('should handle complex reasoning scenarios', async () => {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Consider this philosophical and practical dilemma: In a world where climate change is accelerating, populations are aging, and technological disruption is constant, what should be the primary focus of national policy - economic growth, environmental sustainability, social equity, or technological advancement? Analyze the trade-offs between these priorities, considering both short-term and long-term consequences. Think about how different countries might approach this differently based on their current circumstances and values. Please provide a thoughtful analysis with your reasoning process.'
      }
    ]);

    let reasoningEvents = 0;

    const options: LangOptions = {
      onResult: (result) => {
        if (result.thinking) {
          reasoningEvents++;
          console.log(`🧠 Complex reasoning event ${reasoningEvents} (${lang.constructor.name}):`, result.thinking.length, 'chars');
        }
      }
    };

    const result = await lang.chat(messages, options);
    
    expect(result.answer).toBeDefined();
    expect(result.finished).toBe(true);
    expect(result.answer.length).toBeGreaterThan(100);
    
    console.log(`\n📊 ${lang.constructor.name} Complex Reasoning:`);
    console.log(`   Reasoning events: ${reasoningEvents}`);
    console.log(`   Has reasoning: ${!!result.thinking}`);
    console.log(`   Answer length: ${result.answer.length} characters`);
  });
}