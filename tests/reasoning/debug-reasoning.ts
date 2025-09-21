#!/usr/bin/env tsx

/**
 * Debug script to test reasoning detection
 * Run with: npx tsx tests/reasoning/debug-reasoning.ts
 */

import { Lang } from '../../dist/index.js';

async function debugReasoningDetection() {
  console.log('🔍 Debugging Reasoning Detection\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('❌ ANTHROPIC_API_KEY not found');
    return;
  }

  // Test with different models and configurations
  const configs = [
    {
      name: 'Claude 3.5 Sonnet (latest)',
      model: 'claude-3-5-sonnet-20241022',
      extendedThinking: true
    },
    {
      name: 'Claude 3.5 Sonnet (without extended thinking)',
      model: 'claude-3-5-sonnet-20241022',
      extendedThinking: false
    },
    {
      name: 'Claude 3.5 Sonnet (default)',
      model: 'claude-3-5-sonnet-20241022'
    }
  ];

  const testPrompt = `Solve this step by step: What is 15% of 240? Show your reasoning process clearly.`;

  for (const config of configs) {
    console.log(`\n🧪 Testing: ${config.name}`);
    console.log('=' .repeat(60));

    try {
      const lang = Lang.anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: config.model,
        extendedThinking: config.extendedThinking
      });

      console.log(`📋 Configuration:`);
      console.log(`   Model: ${config.model}`);
      console.log(`   Extended Thinking: ${config.extendedThinking}`);
      console.log(`   Internal Config:`, (lang as any)._config);

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

      console.log(`\n📊 Results:`);
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
      console.log(`❌ Error: ${error.message}`);
    }
  }

  // Test with a more complex prompt that should trigger reasoning
  console.log(`\n\n🔬 Testing with complex reasoning prompt`);
  console.log('=' .repeat(60));

  const complexPrompt = `You are a mathematician. Solve this problem step by step:

A company has 100 employees. 30% are engineers, 25% are designers, 20% are managers, and the rest are in other roles. 
If they want to reduce headcount by 15%, how many people need to be let go from each department if they maintain the same proportions?

Show your detailed mathematical reasoning process.`;

  try {
    const lang = Lang.anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      extendedThinking: true
    });

    console.log('🚀 Sending complex reasoning request...');

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
}

// Run the debug if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  debugReasoningDetection().catch(console.error);
}

export { debugReasoningDetection };