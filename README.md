# AIWrapper

A small, npm-first AI wrapper for JavaScript and TypeScript. One message and
tool-calling API across language providers, with separate interfaces for native
live models, speech, and agents.

```sh
npm install aiwrapper
```

Requires Node.js 20+ or a modern browser. The package is ESM; browser requests
also depend on provider CORS support. Keep long-lived API keys on your server.
The API is evolving and may change between releases.

## Generate text

```ts
import { Lang } from "aiwrapper";

const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY! });
const result = await lang.ask("Explain closures in one sentence.");
console.log(result.answer);

result.addUserMessage("Show a JavaScript example.");
const followUp = await lang.chat(result);
console.log(followUp.answer);
```

See [language providers](docs/language-provider.md) for provider selection,
streaming, structured output, images, custom endpoints, and AWS Bedrock.

## Run an agent with tools

```ts
import { ChatAgent, Lang, LangMessage } from "aiwrapper";

const agent = new ChatAgent(
  Lang.openai({ apiKey: process.env.OPENAI_API_KEY! }),
  { tools: [{
    name: "get_time",
    description: "Get the current UTC time",
    parameters: { type: "object", properties: {} },
    handler: () => ({ now: new Date().toISOString() }),
  }] },
);

const result = await agent.run([new LangMessage("user", "What time is it?")]);
console.log(result.answer);
```

`ChatAgent` keeps history and handles the model/tool loop. See
[agents and tools](docs/agent.md) for cancellation, events, and tool results.

## Connect to a live model

```ts
import { LiveLang } from "aiwrapper";

const session = await LiveLang.openai({
  apiKey: process.env.OPENAI_API_KEY!,
}).connect({
  instructions: "Keep spoken answers brief.",
  onEvent: event => console.log(event),
});

// Supply PCM frames from your application's microphone transport.
await session.appendAudio(microphoneFrame);
await session.close();
```

See [live sessions](docs/live-sessions.md) for Gemini and other native voice
providers, [speech](docs/speech.md) for transcription and synthesis, or
[realtime agents](docs/realtime-agent.md) for an STT → LLM → TTS pipeline.

## Try it and contribute

The [browser playground](playground/README.md) includes chat, speech, realtime
agents, and native live voice. Start with the [documentation index](docs/README.md)
for setup, tests, and development rules.
