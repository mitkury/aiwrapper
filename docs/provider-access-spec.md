# Provider Access Specification

## Overview
This spec describes the new provider access pattern for AIWrapper, focusing on dynamic provider access and model information.

## Breaking Changes

1. Rename `LanguageModel` to `LanguageProvider`
- More accurately reflects its role as a provider implementation
- Each provider handles its own requirements and capabilities
- The term "model" is reserved for actual AI models from aimodels

## Provider Access Patterns

### Direct Provider Access
When you know which provider you want to use:
```typescript
// Use specific provider directly
const openai = Lang.openai({ apiKey: "...", model: "gpt-4" });
const anthropic = Lang.anthropic({ apiKey: "...", model: "claude-3" });
const ollama = Lang.ollama({ model: "llama2" });

// TypeScript provides proper types for options
const result = await openai.ask("Hello!");
console.log(result.answer);
```

### Dynamic Provider Access
When provider choice is determined at runtime:
```typescript
// Get provider by ID
const lang = Lang["openai"]({ apiKey: "..." });

// Or based on model selection
const model = Lang.models.withContext(32000)[0];
const lang = Lang[model.provider]({ model: model.id });

const result = await lang.ask("Hello!");
console.log(result.answer);
```

### Model-Centric Access
`Lang.models` exposes aimodels' ModelCollection, which provides rich filtering and discovery capabilities:

```typescript
// Find specific model
const model = Lang.models.id("gpt-4");

// Filter by capabilities
const models = Lang.models
  .canSee()    // can process images
  .canSpeak()  // can generate speech
  .withContext(32000);  // specific context size

// Initialize provider with selected model
const model = models[0];
const lang = Lang[model.provider]({
  model: model.id
});

// Set required options
if (lang.needsApiKey) {
  lang.setOption('apiKey', key);
}

// Use the initialized model
const result = await lang.ask("Hello!");
console.log(result.answer);
```

The ModelCollection extends Array<Model> and maintains proper typing through operations like `filter()` and `slice()`. All models follow the aimodels Model interface which includes rich metadata about capabilities, context windows, and more.

### Provider Information
We use the Provider interface directly from AIModels:
```typescript
interface Provider {
  /** Provider identifier */
  id: string;
  /** Display name */
  name: string;
  /** Website URL */
  websiteUrl: string;
  /** API endpoint */
  apiUrl: string;
  /** Default model */
  defaultModel?: string;
  /** Whether this is a local provider */
  isLocal?: number;
  /** Model pricing */
  models: Record<string, TokenBasedPricePerMillionTokens | ImagePrice>;
}
```

### Provider Implementation
Each provider implementation (formerly LanguageModel) handles its own requirements:

```typescript
// Provider-specific options (user-provided)
interface OpenAILikeOptions {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
}

// Internal config (processed options)
type OpenAILikeConfig = {
  apiKey: string;
  name: string;
  systemPrompt: string;
  maxTokens?: number;
  baseURL: string;
  headers?: Record<string, string>;
};

abstract class LanguageProvider {
  // Core properties
  protected _config: ProviderConfig;
  protected modelInfo?: Model;  // From aimodels
  
  constructor(options: ProviderOptions) {
    // Get model info from aimodels
    const modelInfo = models.id(options.model);
    this.modelInfo = modelInfo;

    // Process options into config
    this._config = {
      ...this.processOptions(options),
      // Provider-specific defaults
    };

    // Validate maxTokens against model context
    if (modelInfo?.context?.maxOutput && this._config.maxTokens) {
      this._config.maxTokens = Math.min(
        this._config.maxTokens,
        modelInfo.context.maxOutput
      );
    }
  }

  // Dynamic option handling
  abstract get needsApiKey(): boolean;
  setOption(key: string, value: any): void;
  
  // Core functionality with streaming support
  abstract ask(
    prompt: string,
    onResult: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString>;

  abstract chat(
    messages: LangChatMessages,
    onResult: (result: LangResultWithMessages) => void,
  ): Promise<LangResultWithMessages>;

  askForObject<T>(
    promptObj: PromptForObject,
    onResult?: (result: LangResultWithObject) => void,
  ): Promise<LangResultWithObject>;
}
```