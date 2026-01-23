# Language provider

`LanguageProvider` is the abstract adapter that all LLM integrations implement. It defines the three core methods (`ask`, `chat`, `askForObject`) plus the shared `LangOptions` contract for streaming, abort signals, schemas, and provider-specific headers/body overrides. It also exposes shared types like `LangMessage`, `LangMessages`, `LangImageOutput`, and the `LangResult` compatibility wrapper for older code paths.

In practice, every concrete provider class (OpenAI, Anthropic, Ollama, etc.) extends `LanguageProvider` and returns `LangMessages` so agents can keep a consistent conversation history. `askForObject` is implemented once here and delegates to `chat` with a schema so each provider can opt into native structured output where possible.

See [agent.md](agent.md) for how agents use a `LanguageProvider` instance to drive conversations and maintain message history.
