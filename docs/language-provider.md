# Language providers

`LanguageProvider` is the common interface implemented by every model provider.

## Core methods

- `ask(prompt, options?)` starts a conversation from a string.
- `chat(messages, options?)` continues a `LangMessages` conversation.
- `askForObject(prompt, schema, options?)` requests and validates structured output with Zod or JSON Schema.

All three methods return `LangMessages`. Useful properties include:

- `answer`: text from the latest assistant message.
- `object`: parsed structured output from the latest answer.
- `assistantImages`: images from the latest assistant message.
- `finished` and `aborted`: request state.
- `availableTools`: tools available for the next provider call.

## Options

`LangOptions` supports:

- `onResult(message)` for streaming updates.
- `signal` for cancellation.
- `schema` for structured output. `askForObject` sets this automatically.
- `providerSpecificBody` for provider request fields not exposed by the shared API.
- `providerSpecificHeaders` for extra request headers.

Provider constructors can accept `defaultOptions`. Per-call options override those defaults.

```ts
const lang = Lang.openai({
  apiKey: process.env.OPENAI_API_KEY,
  defaultOptions: {
    providerSpecificBody: { truncation: "auto" },
  },
});

const result = await lang.ask("Hello", {
  onResult: message => console.log(message.text),
});
```

`onResult` receives the current message as it is updated, not a standalone text delta.

## Messages

Use `LangMessage` and `LangMessages` when you need conversation history, images, tools, reasoning, or metadata.

```ts
const messages = new LangMessages();
messages.instructions = "Answer concisely.";
messages.addUserMessage("What is a closure?");

const result = await lang.chat(messages);
result.addUserMessage("Show an example.");
const followUp = await lang.chat(result);
```

See [agent.md](agent.md) for orchestration with `ChatAgent`.

## Compatibility

`LangResult` is retained for older provider implementations. It extends `LangMessages` and exposes a `messages` getter that returns itself. New code should use `LangMessages` directly.
