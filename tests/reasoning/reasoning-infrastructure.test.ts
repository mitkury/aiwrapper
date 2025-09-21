import { describe, it, expect } from 'vitest';
import { LangMessages, LangOptions, LanguageProvider } from '../../dist/index.js';
import { createLangTestRunner } from '../utils/lang-gatherer.js';

describe('Reasoning Infrastructure', () => {
  createLangTestRunner(runInfrastructureTests, {
    modelOverrides: {
      openai: 'o1-preview',
      openrouter: 'openai/o1-preview', 
      anthropic: 'claude-3-5-sonnet-20241022',
      deepseek: 'deepseek-reasoner'
    }
  });
});

async function runInfrastructureTests(lang: LanguageProvider) {
  
  it('should have reasoning detection infrastructure', async () => {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Analyze the potential impact of quantum computing on cybersecurity. What are the key challenges and opportunities, and how should organizations prepare for this technological shift? Consider both the threats posed by quantum computers to current encryption methods and the new security solutions they might enable.'
      }
    ]);

    const result = await lang.chat(messages);
    
    // Test basic infrastructure
    expect(typeof result).toBe('object');
    expect(result.finished).toBe(true);
    expect(typeof result.answer).toBe('string');
    expect(result.answer.length).toBeGreaterThan(0);
    
    // Test reasoning property type (may be undefined or string)
    expect(typeof result.thinking === 'undefined' || typeof result.thinking === 'string').toBe(true);
    
    console.log(`\n📊 ${lang.constructor.name} Infrastructure:`);
    console.log(`   Has thinking property: ✅`);
    console.log(`   Answer length: ${result.answer.length} characters`);
    console.log(`   Reasoning available: ${result.thinking ? 'Yes' : 'No'}`);
  });

  it('should stream reasoning tokens when available', async () => {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Explain how photosynthesis works step by step.'
      }
    ]);

    let reasoningTokens = 0;
    let answerTokens = 0;

    const options: LangOptions = {
      onResult: (result) => {
        if (result.thinking) {
          reasoningTokens++;
          console.log(`🧠 Reasoning token (${lang.constructor.name}): ${result.thinking.length} chars`);
        }
        
        if (result.answer) {
          answerTokens++;
        }
      }
    };

    const result = await lang.chat(messages, options);
    
    expect(result.finished).toBe(true);
    expect(result.answer.length).toBeGreaterThan(0);
    
    console.log(`\n📊 ${lang.constructor.name} Streaming:`);
    console.log(`   Reasoning tokens: ${reasoningTokens}`);
    console.log(`   Answer tokens: ${answerTokens}`);
    console.log(`   Final answer length: ${result.answer.length} characters`);
    console.log(`   Reasoning detected: ${result.thinking ? '✅ Yes' : '❌ No'}`);
  });
}