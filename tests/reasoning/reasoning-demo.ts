#!/usr/bin/env tsx

/**
 * Simple demo script to test reasoning detection
 * Run with: npx tsx tests/reasoning/reasoning-demo.ts
 */

import { Lang } from '../dist/index.js';

async function testReasoningDetection() {
  console.log('🧠 Testing Reasoning Detection Across Providers\n');

  // Test providers that support reasoning
  const providers = [
    { name: 'Anthropic', provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    { name: 'OpenAI o1', provider: 'openai', model: 'o1-preview' },
    { name: 'OpenAI o1-mini', provider: 'openai', model: 'o1-mini' },
  ];

  const testPrompt = `Solve this step by step: A farmer has chickens and rabbits. Together they have 35 heads and 94 legs. How many chickens and how many rabbits does the farmer have? Show your reasoning process.`;

  for (const { name, provider, model } of providers) {
    console.log(`\n🔍 Testing ${name} (${model})`);
    console.log('=' .repeat(50));

    try {
      let lang;
      
      if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
        lang = Lang.anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: model,
          extendedThinking: true // Enable reasoning for Anthropic
        });
      } else if (provider === 'openai' && process.env.OPENAI_API_KEY) {
        lang = Lang.openai({
          apiKey: process.env.OPENAI_API_KEY,
          model: model
        });
      } else {
        console.log(`⚠️  Skipping ${name} - API key not available`);
        continue;
      }

      let reasoningDetected = false;
      let reasoningLength = 0;
      let finalAnswer = '';

      const result = await lang.ask(testPrompt, {
        onResult: (res) => {
          if (res.thinking && res.thinking.length > reasoningLength) {
            reasoningDetected = true;
            reasoningLength = res.thinking.length;
            
            console.log(`🧠 Reasoning detected (${res.thinking.length} chars):`);
            console.log(`   ${res.thinking.substring(0, 100)}...`);
          }
          
          if (res.answer) {
            finalAnswer = res.answer;
          }
        }
      });

      console.log(`\n📊 Results for ${name}:`);
      console.log(`   Reasoning detected: ${reasoningDetected ? '✅ Yes' : '❌ No'}`);
      console.log(`   Reasoning length: ${reasoningLength} characters`);
      console.log(`   Final answer length: ${result.answer?.length || 0} characters`);
      console.log(`   Answer preview: ${result.answer?.substring(0, 100)}...`);
      
      if (result.thinking) {
        console.log(`\n🧠 Final reasoning content:`);
        console.log(result.thinking.substring(0, 300) + '...');
      }

    } catch (error) {
      console.log(`❌ Error testing ${name}: ${error.message}`);
    }
  }

  console.log('\n✨ Reasoning detection test completed!');
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testReasoningDetection().catch(console.error);
}

export { testReasoningDetection };