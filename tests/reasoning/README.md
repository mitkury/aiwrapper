# Reasoning Tests

Tests that verify reasoning detection and streaming work across AI providers.

## What It Tests

- **Reasoning Detection**: Models that support reasoning can be detected
- **Reasoning Streaming**: Reasoning tokens stream in real-time when available
- **Infrastructure**: Basic reasoning support infrastructure works

## Running Tests

```bash
# Run all reasoning tests
npm run test:reasoning

# Run for specific provider
TEST_PROVIDERS=deepseek npm run test:reasoning
```

## What You'll See

- ✅ **When reasoning works**: `result.thinking` contains reasoning content, streaming shows reasoning tokens
- ❌ **When reasoning unavailable**: `result.thinking` is empty, normal streaming continues

## Provider Support

Tests automatically use reasoning-capable models when available. Current support varies by provider and model availability.

## Usage

```typescript
const result = await lang.ask('Think step by step...', {
  onResult: (res) => {
    if (res.thinking) {
      console.log('🧠 Reasoning:', res.thinking);
    }
  }
});

console.log('Answer:', result.answer);
console.log('Reasoning:', result.thinking);
```