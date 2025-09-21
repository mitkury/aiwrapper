#!/usr/bin/env tsx

/**
 * Debug script to test DeepSeek reasoning detection
 * Run with: npx tsx tests/reasoning/debug-deepseek-reasoning.ts
 */

import { Lang } from '../../dist/index.js';

async function debugDeepSeekReasoningDetection() {
  console.log('🔍 Debugging DeepSeek Reasoning Detection\n');

  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('❌ DEEPSEEK_API_KEY not found');
    return;
  }

  // Test with different DeepSeek models
  const models = [
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-coder',
  ];

  const testPrompt = `Solve this step by step: What is 25% of 320? Show your detailed reasoning process.`;

  for (const model of models) {
    console.log(`\n🧪 Testing DeepSeek Model: ${model}`);
    console.log('=' .repeat(60));

    try {
      const lang = Lang.deepseek({
        apiKey: process.env.DEEPSEEK_API_KEY,
        model: model
      });

      console.log(`📋 Configuration:`);
      console.log(`   Model: ${model}`);
      console.log(`   Supports Reasoning: ${(lang as any).supportsReasoning?.() || 'Unknown'}`);

      let reasoningDetected = false;
      let reasoningContent = '';
      let answerContent = '';
      let eventCount = 0;

      const result = await lang.ask(testPrompt, {
        onResult: (res) => {
          eventCount++;
          
          if (res.thinking) {
            reasoningDetected = true;
            reasoningContent = res.thinking;
            console.log(`🧠 Reasoning detected (event ${eventCount}):`, {
              length: res.thinking.length,
              preview: res.thinking.substring(0, 100) + '...'
            });
          }
          
          if (res.answer) {
            answerContent = res.answer;
          }
        }
      });

      console.log(`\n📊 Results for ${model}:`);
      console.log(`   Total events: ${eventCount}`);
      console.log(`   Reasoning detected: ${reasoningDetected ? '✅ Yes' : '❌ No'}`);
      console.log(`   Reasoning length: ${reasoningContent.length} characters`);
      console.log(`   Answer length: ${answerContent.length} characters`);
      console.log(`   Final thinking: ${result.thinking ? 'Present' : 'Missing'}`);
      console.log(`   Final thinking length: ${result.thinking?.length || 0} characters`);
      
      if (result.thinking) {
        console.log(`\n🧠 Final reasoning content:`);
        console.log(result.thinking.substring(0, 300) + '...');
      }

      console.log(`\n📝 Final answer:`);
      console.log(result.answer.substring(0, 200) + '...');

    } catch (error) {
      console.log(`❌ Error with ${model}: ${error.message}`);
    }
  }

  // Test with a complex reasoning prompt
  console.log(`\n\n🔬 Testing DeepSeek with complex reasoning prompt`);
  console.log('=' .repeat(60));

  const complexPrompt = `You are a mathematician. Solve this problem step by step:

A company has 120 employees. 35% are engineers, 30% are designers, 20% are managers, and the rest are in other roles. 
If they want to reduce headcount by 20%, how many people need to be let go from each department if they maintain the same proportions?

Show your detailed mathematical reasoning process.`;

  try {
    const lang = Lang.deepseek({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-chat'
    });

    console.log('🚀 Sending complex reasoning request to DeepSeek...');

    const result = await lang.ask(complexPrompt, {
      onResult: (res) => {
        if (res.thinking) {
          console.log(`🧠 Complex reasoning detected:`, res.thinking.length, 'characters');
          console.log(`Preview: ${res.thinking.substring(0, 150)}...`);
        }
      }
    });

    console.log(`\n📊 Complex reasoning results:`);
    console.log(`   Has thinking: ${!!result.thinking}`);
    console.log(`   Thinking length: ${result.thinking?.length || 0} characters`);
    console.log(`   Answer length: ${result.answer?.length || 0} characters`);

    if (result.thinking) {
      console.log(`\n🧠 Complex reasoning content:`);
      console.log(result.thinking);
    }

  } catch (error) {
    console.log(`❌ Complex reasoning error: ${error.message}`);
  }

  // Test reasoning with different prompt styles
  console.log(`\n\n🎯 Testing DeepSeek with different reasoning prompt styles`);
  console.log('=' .repeat(60));

  const reasoningPrompts = [
    {
      name: 'Explicit Reasoning Request',
      prompt: 'Think step by step and show your reasoning: What is 18% of 450?'
    },
    {
      name: 'Chain of Thought',
      prompt: 'Use chain of thought reasoning to solve: If a car travels 240 miles in 4 hours, what is its average speed?'
    },
    {
      name: 'Mathematical Proof',
      prompt: 'Prove step by step: Why is the sum of angles in a triangle always 180 degrees?'
    }
  ];

  for (const promptTest of reasoningPrompts) {
    console.log(`\n🧪 Testing: ${promptTest.name}`);
    
    try {
      const lang = Lang.deepseek({
        apiKey: process.env.DEEPSEEK_API_KEY,
        model: 'deepseek-chat'
      });

      let reasoningEvents = 0;

      const result = await lang.ask(promptTest.prompt, {
        onResult: (res) => {
          if (res.thinking) {
            reasoningEvents++;
            console.log(`   🧠 Reasoning event ${reasoningEvents}: ${res.thinking.length} chars`);
          }
        }
      });

      console.log(`📊 ${promptTest.name} Results:`);
      console.log(`   Reasoning events: ${reasoningEvents}`);
      console.log(`   Has reasoning: ${!!result.thinking}`);
      console.log(`   Answer length: ${result.answer?.length || 0} characters`);

    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  }
}

// Run the debug if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  debugDeepSeekReasoningDetection().catch(console.error);
}

export { debugDeepSeekReasoningDetection };