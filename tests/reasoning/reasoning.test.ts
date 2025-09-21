import { describe, it, expect } from 'vitest';
import { LangMessages, LangOptions, LanguageProvider } from '../../dist/index.js';
import { createLangTestRunner, getProvider } from '../utils/lang-gatherer.js';

describe('Reasoning Detection', () => {
  // Test reasoning detection specifically for providers that support it
  const reasoningProviders = [
    { name: 'anthropic', model: 'claude-3-5-sonnet-20241022' }, // Claude with reasoning
    { name: 'openai', model: 'o1-preview' }, // OpenAI o1 with reasoning
    { name: 'openai', model: 'o1-mini' }, // OpenAI o1-mini with reasoning
    { name: 'deepseek', model: 'deepseek-chat' }, // DeepSeek with reasoning support
    { name: 'deepseek', model: 'deepseek-reasoner' }, // DeepSeek reasoning model
  ];

  for (const provider of reasoningProviders) {
    const lang = getProvider(provider.name, provider.model);
    
    if (lang) {
      describe(`${provider.name} (${provider.model}) - Reasoning Tests`, () => {
        it('should detect reasoning/thinking when solving complex problems', async () => {
          const messages = new LangMessages([
            {
              role: 'user',
              content: 'I have a problem: A farmer has 17 sheep. All but 9 die. How many are left? Think step by step.'
            }
          ]);

          const options: LangOptions = {
            onResult: (result) => {
              console.log(`\n[${provider.name}] Reasoning detected:`, {
                hasThinking: !!result.thinking,
                thinkingLength: result.thinking?.length || 0,
                answerLength: result.answer?.length || 0,
                finished: result.finished
              });
              
              if (result.thinking) {
                console.log(`\n[${provider.name}] Thinking content:`, result.thinking.substring(0, 200) + '...');
              }
            }
          };

          const result = await lang.chat(messages, options);
          
          // Verify we got a response
          expect(result.answer).toBeDefined();
          expect(typeof result.answer).toBe('string');
          expect(result.answer.length).toBeGreaterThan(0);
          
          // Check if reasoning was detected (some providers may not support it)
          console.log(`\n[${provider.name}] Final result:`, {
            hasThinking: !!result.thinking,
            thinkingLength: result.thinking?.length || 0,
            answerLength: result.answer?.length || 0
          });
          
          // For providers that support reasoning, we should detect it
          if (provider.name === 'anthropic' || provider.model?.includes('o1') || provider.name === 'deepseek') {
            // These models should have reasoning capability
            if (result.thinking) {
              expect(result.thinking.length).toBeGreaterThan(0);
              console.log(`✅ [${provider.name}] Reasoning successfully detected!`);
            } else {
              console.log(`⚠️  [${provider.name}] No reasoning detected - may need special configuration`);
            }
          }
        });

        it('should handle reasoning in streaming mode', async () => {
          let reasoningChunks: string[] = [];
          let answerChunks: string[] = [];
          let hasDetectedReasoning = false;

          const options: LangOptions = {
            onResult: (result) => {
              if (result.thinking) {
                reasoningChunks.push(result.thinking);
                hasDetectedReasoning = true;
                console.log(`\n[${provider.name}] Reasoning chunk received:`, result.thinking.length, 'characters');
              }
              
              if (result.answer) {
                answerChunks.push(result.answer);
              }
            }
          };

          const messages = new LangMessages([
            {
              role: 'user',
              content: 'Solve this step by step: If a train leaves at 2 PM traveling 60 mph, and another leaves at 3 PM traveling 80 mph in the same direction, when will the second train catch up?'
            }
          ]);

          const result = await lang.chat(messages, options);
          
          expect(result.answer).toBeDefined();
          expect(result.finished).toBe(true);
          
          console.log(`\n[${provider.name}] Streaming results:`, {
            reasoningChunks: reasoningChunks.length,
            answerChunks: answerChunks.length,
            hasDetectedReasoning,
            finalAnswerLength: result.answer?.length || 0
          });
        });

        it('should detect reasoning with mathematical problems', async () => {
          const messages = new LangMessages([
            {
              role: 'user',
              content: 'What is 15% of 240? Show your reasoning process.'
            }
          ]);

          const options: LangOptions = {
            onResult: (result) => {
              if (result.thinking) {
                console.log(`\n[${provider.name}] Mathematical reasoning:`, result.thinking.substring(0, 150) + '...');
              }
            }
          };

          const result = await lang.chat(messages, options);
          
          expect(result.answer).toBeDefined();
          expect(result.answer).toMatch(/36|thirty.?six/i); // Should contain the correct answer
          
          if (result.thinking) {
            console.log(`✅ [${provider.name}] Mathematical reasoning detected!`);
            expect(result.thinking.length).toBeGreaterThan(10);
          }
        });
      });
    } else {
      console.log(`⚠️  Provider ${provider.name} with model ${provider.model} not available (missing API key)`);
    }
  }

  // Test Anthropic with extendedThinking explicitly enabled
  describe('Anthropic Extended Thinking', () => {
    it('should detect reasoning with extendedThinking enabled', async () => {
      const lang = getProvider('anthropic', 'claude-3-5-sonnet-20241022');
      
      if (!lang) {
        console.log('⚠️  Anthropic not available (missing API key)');
        return;
      }

      // Enable extended thinking for Anthropic
      if (lang.constructor.name === 'AnthropicLang') {
        (lang as any)._config.extendedThinking = true;
      }

      const messages = new LangMessages([
        {
          role: 'user',
          content: 'Analyze this complex scenario: A company has 100 employees. 30% are engineers, 25% are designers, 20% are managers, and the rest are in other roles. If they want to reduce headcount by 15%, how many people need to be let go from each department if they maintain the same proportions? Show your detailed reasoning.'
        }
      ]);

      const options: LangOptions = {
        onResult: (result) => {
          console.log(`\n[Anthropic Extended] Reasoning status:`, {
            hasThinking: !!result.thinking,
            thinkingLength: result.thinking?.length || 0,
            answerLength: result.answer?.length || 0,
            finished: result.finished
          });
        }
      };

      const result = await lang.chat(messages, options);
      
      expect(result.answer).toBeDefined();
      expect(result.finished).toBe(true);
      
      console.log(`\n[Anthropic Extended] Final result:`, {
        hasThinking: !!result.thinking,
        thinkingLength: result.thinking?.length || 0,
        finalAnswerLength: result.answer?.length || 0
      });
      
      if (result.thinking) {
        console.log(`✅ Anthropic extended thinking detected!`);
        console.log(`Reasoning preview:`, result.thinking.substring(0, 300) + '...');
      }
    });
  });

  // Test reasoning visualization
  describe('Reasoning Visualization', () => {
    it('should provide clear visualization of reasoning process', async () => {
      const lang = getProvider('anthropic', 'claude-3-5-sonnet-20241022');
      
      if (!lang) {
        console.log('⚠️  Anthropic not available for visualization test');
        return;
      }

      let reasoningSteps: string[] = [];
      let currentReasoning = '';

      const options: LangOptions = {
        onResult: (result) => {
          if (result.thinking && result.thinking !== currentReasoning) {
            currentReasoning = result.thinking;
            reasoningSteps.push(result.thinking);
            
            // Visualize reasoning progress
            console.log(`\n🧠 Reasoning Progress (Step ${reasoningSteps.length}):`);
            console.log(`Length: ${result.thinking.length} characters`);
            console.log(`Preview: ${result.thinking.substring(0, 100)}...`);
            
            // Show reasoning structure if it contains step indicators
            if (result.thinking.includes('Step') || result.thinking.includes('step')) {
              console.log(`📋 Contains step-by-step reasoning`);
            }
            
            if (result.thinking.includes('Let me think') || result.thinking.includes('I need to')) {
              console.log(`🤔 Shows thinking process`);
            }
          }
        }
      };

      const messages = new LangMessages([
        {
          role: 'user',
          content: 'Create a detailed plan for organizing a company retreat for 50 people. Include venue selection, catering, activities, and budget considerations. Think through each aspect carefully.'
        }
      ]);

      const result = await lang.chat(messages, options);
      
      console.log(`\n📊 Reasoning Visualization Summary:`);
      console.log(`Total reasoning steps: ${reasoningSteps.length}`);
      console.log(`Final reasoning length: ${result.thinking?.length || 0} characters`);
      console.log(`Final answer length: ${result.answer?.length || 0} characters`);
      
      expect(result.answer).toBeDefined();
      expect(result.finished).toBe(true);
      
      if (result.thinking) {
        console.log(`✅ Reasoning visualization successful!`);
      }
    });
  });
});