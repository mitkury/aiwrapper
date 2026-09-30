# Language providers

`Lang` constructs providers implementing `LanguageProvider`. They share
`ask(prompt, options?)`, `chat(messages, options?)`, and
`askForObject(prompt, schema, options?)`.

## Choose a provider

| Factory | Provider |
| --- | --- |
| `Lang.openai()` | OpenAI Responses API |
| `Lang.anthropic()` | Anthropic |
| `Lang.google()` | Google Gemini |
| `Lang.openrouter()` | OpenRouter |
| `Lang.ollama()` | Ollama |
| `Lang.groq()`, `Lang.deepseek()`, `Lang.kimi()` | Groq, DeepSeek, Moonshot Kimi |
| `Lang.xai()`, `Lang.cohere()`, `Lang.mistral()` | xAI, Cohere, Mistral |
| `Lang.openaiLike()` | Custom OpenAI-compatible Chat Completions endpoints |
| `new BedrockLang()` | AWS Bedrock; see [setup below](#aws-bedrock) |

Pass credentials and a `model` to the chosen factory. Constructor options and
model capabilities vary by provider. `Lang.models` exposes the bundled catalog
of chat-capable models; it is not a guarantee of access through your account.

```ts
import { Lang } from "aiwrapper";

const lang = Lang.openaiLike({
  baseURL: "http://localhost:8000/v1",
  model: "your-model",
  // apiKey is optional for endpoints that do not require authentication.
});
const result = await lang.ask("Hello");
console.log(result.answer);
```

Custom endpoints also accept `systemPrompt`, `maxTokens`, `headers`, and
`bodyProperties`. OpenRouter accepts `siteUrl` and `siteName` for attribution.

## Messages and streaming

All three methods return `LangMessages`. Its `answer`, `object`, and
`assistantImages` getters expose the latest assistant output; `finished` and
`aborted` describe request state. Individual messages contain text, reasoning,
images, tool requests/results, and optional metadata.

```ts
import { Lang, LangMessages } from "aiwrapper";

const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY! });
const messages = new LangMessages();
messages.instructions = "Answer concisely.";
messages.addUserMessage("What is a closure?");

const result = await lang.chat(messages, {
  onResult: message => console.log(message.text),
});
result.addUserMessage("Show an example.");
const followUp = await lang.chat(result);
```

`onResult` receives the current message as it changes, not a standalone delta.
Do not share a mutable conversation between concurrent requests; message copies
are shallow. `LangResult` is a compatibility subclass whose `messages` getter
returns itself. New code can use `LangMessages` directly.

Per-call options include `signal`, `tools`, `schema`, `providerSpecificBody`,
and `providerSpecificHeaders`. They override constructor `defaultOptions`.
`tools: []` disables tools for that call without changing the conversation's
`availableTools`. See [agents and tools](agent.md) for handlers and tool loops.

## Structured output

```ts
import { z } from "aiwrapper";

const result = await lang.askForObject(
  "Suggest three names for a coffee shop.",
  z.object({ names: z.array(z.string()) }),
);
console.log(result.object);
```

JSON Schema objects are also accepted. `askForObject` sets the request schema;
providers use native structured output or their supported prompting path and
validate the result.

## Images

`LangMessage` supports image content alongside text. Image formats and model
support differ by provider; [image tests](../tests/img-in) contain examples.
Use [multimodal tool results](agent.md#image-tool-results) to return images from
handlers.

`Lang.openai()` uses Responses; `Lang.openaiLike()` uses Chat Completions.
Responses image generation uses the provider's `image_generation` built-in tool.
AIWrapper exposes completed images through `assistantImages`; streamed partial
previews are not exposed. The separate `Img` API handles image generation
without a conversation; see [its source](../src/img/img.ts).

## AWS Bedrock

Install the optional SDK and import the separate entry point:

```sh
npm install aiwrapper @aws-sdk/client-bedrock-runtime
```

```ts
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockLang } from "aiwrapper/bedrock";

const lang = new BedrockLang({
  client: new BedrockRuntimeClient({ region: "us-east-1" }),
  model: "your-model-id-or-inference-profile-arn",
});
console.log((await lang.ask("Hello")).answer);
```

The AWS client handles credentials, signing, and retries. AIWrapper uses
`ConverseStream`, passing `model` as `modelId`. Choose a model supporting that
API and the features you need: streaming, tools, images, reasoning, or JSON
Schema output.

Constructor inference options are `maxTokens`, `temperature`, `topP`, and
`stopSequences`. Per-call `providerSpecificBody` fields are applied last.
`providerSpecificHeaders` is rejected; use SDK middleware for custom headers.
Image inputs accept base64 or data URLs, not remote URLs. Assistant image
output and signed reasoning replay are not represented by this adapter.
