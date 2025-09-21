import { describe, it, expect } from 'vitest';
import { LangMessages, LangOptions, LanguageProvider } from '../../dist/index.js';
import { createLangTestRunner, getProvider } from '../utils/lang-gatherer.js';

describe('Reasoning Infrastructure Tests', () => {
  // Test the reasoning detection infrastructure even if actual reasoning isn't available
  createLangTestRunner(runReasoningInfrastructureTests);
});

async function runReasoningInfrastructureTests(lang: LanguageProvider) {
  
  it('should have reasoning detection infrastructure in place', async () => {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Solve this step by step: What is 25% of 200? Show your reasoning.'
      }
    ]);

    let reasoningEvents = 0;
    let hasReasoningProperty = false;
    let hasThinkingProperty = false;

    const options: LangOptions = {
      onResult: (result) => {
        // Test if the result object has reasoning-related properties
        hasReasoningProperty = 'reasoning' in result;
        hasThinkingProperty = 'thinking' in result;
        
        if (result.thinking) {
          reasoningEvents++;
          console.log(`🧠 Reasoning detected (${lang.constructor.name}):`, {
            length: result.thinking.length,
            preview: result.thinking.substring(0, 50) + '...'
          });
        }
      }
    };

    const result = await lang.chat(messages, options);
    
    // Test infrastructure properties
    expect(typeof result).toBe('object');
    expect(result.finished).toBe(true);
    expect(typeof result.answer).toBe('string');
    expect(result.answer.length).toBeGreaterThan(0);
    
    // Test reasoning properties exist (even if empty)
    expect(hasThinkingProperty).toBe(true); // LangMessages should have thinking property
    // Note: result.thinking may be undefined (not supported) or string (supported but empty)
    expect(typeof result.thinking === 'undefined' || typeof result.thinking === 'string').toBe(true);
    
    console.log(`\n📊 ${lang.constructor.name} Reasoning Infrastructure:`, {
      hasReasoningProperty,
      hasThinkingProperty,
      reasoningEvents,
      finalThinking: result.thinking,
      answerLength: result.answer.length
    });
  });

  it('should handle streaming with reasoning detection callbacks', async () => {
    let streamingEvents = 0;
    let reasoningCallbacks = 0;
    let answerCallbacks = 0;

    const options: LangOptions = {
      onResult: (result) => {
        streamingEvents++;
        
        if (result.thinking) {
          reasoningCallbacks++;
          console.log(`🧠 Reasoning callback (${lang.constructor.name}):`, result.thinking.length, 'chars');
        }
        
        if (result.answer) {
          answerCallbacks++;
        }
      }
    };

    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Explain how photosynthesis works step by step. Think through each part of the process.'
      }
    ]);

    const result = await lang.chat(messages, options);
    
    expect(streamingEvents).toBeGreaterThan(0);
    expect(answerCallbacks).toBeGreaterThan(0);
    expect(result.finished).toBe(true);
    expect(result.answer.length).toBeGreaterThan(50);
    
    console.log(`\n📊 ${lang.constructor.name} Streaming Results:`, {
      streamingEvents,
      reasoningCallbacks,
      answerCallbacks,
      finalAnswerLength: result.answer.length
    });
  });

  it('should support reasoning visualization patterns', async () => {
    const reasoningPatterns = [
      'Let me think about this',
      'First, I need to',
      'Step 1:',
      'The reasoning is',
      'Let me work through this',
      'I should consider'
    ];

    let detectedPatterns: string[] = [];
    let reasoningIndicators = 0;

    const options: LangOptions = {
      onResult: (result) => {
        if (result.thinking) {
          reasoningIndicators++;
          // Check for reasoning patterns in thinking content
          for (const pattern of reasoningPatterns) {
            if (result.thinking.toLowerCase().includes(pattern.toLowerCase())) {
              detectedPatterns.push(pattern);
            }
          }
        }
        
        // Also check for reasoning patterns in the answer
        if (result.answer) {
          for (const pattern of reasoningPatterns) {
            if (result.answer.toLowerCase().includes(pattern.toLowerCase())) {
              detectedPatterns.push(pattern);
            }
          }
        }
      }
    };

    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Analyze this problem step by step: A company has 100 employees. 30% are engineers, 25% are designers, 20% are managers, and the rest are in other roles. If they reduce headcount by 15%, how many people are left in each department?'
      }
    ]);

    const result = await lang.chat(messages, options);
    
    expect(result.answer).toBeDefined();
    expect(result.finished).toBe(true);
    
    console.log(`\n📊 ${lang.constructor.name} Reasoning Pattern Detection:`, {
      reasoningIndicators,
      detectedPatterns: [...new Set(detectedPatterns)],
      answerContainsReasoning: detectedPatterns.length > 0
    });
    
    // The answer should contain some form of reasoning (step-by-step explanation)
    expect(result.answer.length).toBeGreaterThan(100);
  });

  it('should handle complex reasoning scenarios', async () => {
    const scenarios = [
      {
        name: 'Mathematical Reasoning',
        prompt: 'If a train leaves station A at 60 mph and another leaves station B at 80 mph, and they are 200 miles apart, when will they meet? Show your calculations.'
      },
      {
        name: 'Logical Reasoning',
        prompt: 'Three people are wearing hats. Each can see the others\' hats but not their own. All hats are either black or white. Person A says "I don\'t know what color my hat is." Person B says "I don\'t know what color my hat is either." Person C says "I know what color my hat is." What color is Person C\'s hat and how do you know?'
      },
      {
        name: 'Multi-step Planning',
        prompt: 'Plan a 3-day trip to Paris for a family of 4 with a budget of $2000. Consider flights, accommodation, food, and activities. Break down the costs and explain your reasoning.'
      }
    ];

    for (const scenario of scenarios) {
      console.log(`\n🧪 Testing ${scenario.name} scenario with ${lang.constructor.name}`);
      
      let reasoningSteps = 0;
      let hasStructuredResponse = false;
      
      const options: LangOptions = {
        onResult: (result) => {
          if (result.thinking) {
            reasoningSteps++;
          }
          
          if (result.answer && (
            result.answer.includes('Step') || 
            result.answer.includes('First') || 
            result.answer.includes('Next') ||
            result.answer.includes('1.') ||
            result.answer.includes('2.')
          )) {
            hasStructuredResponse = true;
          }
        }
      };

      const messages = new LangMessages([
        { role: 'user', content: scenario.prompt }
      ]);

      const result = await lang.chat(messages, options);
      
      expect(result.answer).toBeDefined();
      expect(result.finished).toBe(true);
      expect(result.answer.length).toBeGreaterThan(50);
      
      console.log(`📊 ${scenario.name} Results:`, {
        reasoningSteps,
        hasStructuredResponse,
        answerLength: result.answer.length,
        answerPreview: result.answer.substring(0, 100) + '...'
      });
    }
  });

  it('should provide reasoning metadata and analytics', async () => {
    const reasoningMetadata = {
      startTime: Date.now(),
      events: [] as any[],
      reasoningDuration: 0,
      answerDuration: 0,
      totalTokens: 0
    };

    const options: LangOptions = {
      onResult: (result) => {
        const event = {
          timestamp: Date.now(),
          hasThinking: !!result.thinking,
          thinkingLength: result.thinking?.length || 0,
          answerLength: result.answer?.length || 0,
          finished: result.finished
        };
        
        reasoningMetadata.events.push(event);
        
        if (result.thinking) {
          reasoningMetadata.reasoningDuration = Date.now() - reasoningMetadata.startTime;
        }
        
        if (result.finished) {
          reasoningMetadata.answerDuration = Date.now() - reasoningMetadata.startTime;
        }
      }
    };

    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Design a sustainable energy system for a small town. Consider solar, wind, and storage options. Provide detailed reasoning for your choices.'
      }
    ]);

    const result = await lang.chat(messages, options);
    
    expect(reasoningMetadata.events.length).toBeGreaterThan(0);
    expect(reasoningMetadata.answerDuration).toBeGreaterThan(0);
    expect(result.finished).toBe(true);
    
    console.log(`\n📊 ${lang.constructor.name} Reasoning Analytics:`, {
      totalEvents: reasoningMetadata.events.length,
      reasoningDuration: reasoningMetadata.reasoningDuration,
      answerDuration: reasoningMetadata.answerDuration,
      eventsWithThinking: reasoningMetadata.events.filter(e => e.hasThinking).length,
      maxAnswerLength: Math.max(...reasoningMetadata.events.map(e => e.answerLength))
    });
  });
}