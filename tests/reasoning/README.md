# Reasoning Detection Tests

Simple tests to verify that reasoning detection and streaming works across AI providers.

## Goal

Ensure that:
1. **Reasoning Detection**: Models that support reasoning can be detected
2. **Reasoning Streaming**: Reasoning tokens are streamed in real-time when available
3. **UI Integration**: Applications can show when reasoning is happening

## Supported Providers

- **DeepSeek**: `deepseek-reasoner` model provides reasoning streams
- **Anthropic**: `extendedThinking` support (when available)
- **OpenAI**: o1 models with reasoning (when available)
- **Other Providers**: Test infrastructure for future reasoning support

## Test Files

- **`reasoning.test.ts`**: Tests reasoning detection and streaming
- **`reasoning-infrastructure.test.ts`**: Tests basic reasoning infrastructure

## Running Tests

```bash
# Run all reasoning tests
npm run test:reasoning

# Run specific test file
npx vitest run tests/reasoning/reasoning.test.ts
```

## Environment Setup

Set API keys for providers you want to test:

```bash
export DEEPSEEK_API_KEY="your_deepseek_api_key"
export ANTHROPIC_API_KEY="your_anthropic_api_key"
export OPENAI_API_KEY="your_openai_api_key"
```

## Expected Behavior

### When Reasoning is Available
- `result.thinking` contains reasoning content
- `onResult` callback receives reasoning tokens during streaming
- Real-time reasoning visualization is possible

### When Reasoning is Not Available
- `result.thinking` is undefined or empty
- Normal response streaming continues
- No errors thrown

## Usage Example

```typescript
import { Lang } from 'aiwrapper';

const lang = Lang.deepseek({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: 'deepseek-reasoner'
});

const result = await lang.ask('Solve this step by step...', {
  onResult: (res) => {
    if (res.thinking) {
      console.log('🧠 Reasoning:', res.thinking);
    }
  }
});

console.log('Answer:', result.answer);
console.log('Reasoning:', result.thinking);
```