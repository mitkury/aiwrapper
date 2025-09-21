# Reasoning Detection Tests

This directory contains tests and demos for reasoning/thinking detection across different AI providers.

## Overview

The reasoning detection system can identify when AI models are performing internal reasoning or "thinking" before providing their final answer. This is particularly useful for:

- Complex problem-solving tasks
- Mathematical calculations
- Multi-step reasoning
- Debugging AI responses
- Understanding model decision-making processes

## Supported Providers

### Anthropic Claude
- **Models**: `claude-3-5-sonnet-20241022` and other Claude models
- **Feature**: Extended thinking with `extendedThinking: true` option
- **Detection**: Automatically detects `thinking_delta` events in streaming responses

### OpenAI o1 Models
- **Models**: `o1-preview`, `o1-mini`
- **Feature**: Built-in reasoning capabilities
- **Detection**: Reasoning content is captured in the response stream

### DeepSeek
- **Models**: `deepseek-chat`, `deepseek-reasoner`, `deepseek-coder`
- **Feature**: Built-in reasoning support with `reasoning_content` in streaming
- **Detection**: Automatically detects `reasoning_content` in delta responses

### Other Providers
- Some providers may support reasoning detection
- Check individual provider documentation for specific capabilities

## Test Files

### `reasoning.test.ts`
Comprehensive test suite that:
- Tests reasoning detection across multiple providers
- Verifies streaming reasoning detection
- Tests mathematical problem-solving with reasoning
- Includes visualization of reasoning process
- Tests Anthropic's extended thinking feature

### `reasoning-demo.ts`
Interactive demo script that:
- Shows real-time reasoning detection
- Demonstrates reasoning visualization
- Tests multiple providers in sequence
- Provides detailed logging of reasoning content

### `debug-deepseek-reasoning.ts`
DeepSeek-specific debug script that:
- Tests DeepSeek reasoning models
- Demonstrates reasoning content detection
- Tests different prompt styles for reasoning
- Provides detailed DeepSeek-specific analytics

## Running Tests

### Run All Reasoning Tests
```bash
npm run test:reasoning
```

### Run Individual Test File
```bash
npx vitest run tests/reasoning/reasoning.test.ts
```

### Run Interactive Demo
```bash
npx tsx tests/reasoning/reasoning-demo.ts
```

### Debug Reasoning Detection
```bash
npx tsx tests/reasoning/debug-reasoning.ts
```

### Debug DeepSeek Reasoning
```bash
npx tsx tests/reasoning/debug-deepseek-reasoning.ts
```

## Environment Setup

Make sure you have the appropriate API keys set:

```bash
# For Anthropic
export ANTHROPIC_API_KEY="your_anthropic_api_key"

# For OpenAI
export OPENAI_API_KEY="your_openai_api_key"

# For DeepSeek
export DEEPSEEK_API_KEY="your_deepseek_api_key"
```

## Expected Behavior

### When Reasoning is Detected
- `result.thinking` property will contain the reasoning content
- Reasoning content streams in real-time during processing
- Final reasoning content is available in the completed result

### When Reasoning is Not Available
- `result.thinking` will be undefined or empty
- Regular response content will still be available in `result.answer`
- No error is thrown - reasoning is an optional feature

## Example Usage

```typescript
import { Lang } from 'aiwrapper';

const lang = Lang.anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  extendedThinking: true // Enable reasoning
});

const result = await lang.ask('Solve this complex problem step by step...', {
  onResult: (res) => {
    if (res.thinking) {
      console.log('🧠 Reasoning:', res.thinking);
    }
  }
});

console.log('Final answer:', result.answer);
console.log('Reasoning:', result.thinking);
```

## Visualization

The tests include visualization features that show:
- When reasoning is being detected
- Length of reasoning content
- Preview of reasoning content
- Step-by-step reasoning progress
- Final reasoning summary

## Troubleshooting

### No Reasoning Detected
- Ensure you're using a model that supports reasoning
- For Anthropic, set `extendedThinking: true`
- Check that API keys are properly configured
- Some models may not always show reasoning for simple queries

### API Errors
- Verify API keys are valid and have sufficient credits
- Check rate limits and quotas
- Ensure you have access to the specific models being tested

### Streaming Issues
- Reasoning detection works best with streaming enabled
- Non-streaming responses may not capture intermediate reasoning steps
- Use the `onResult` callback to capture real-time reasoning