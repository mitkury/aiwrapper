# AIWrapper playground

One browser app for manually testing the local library source.

## Run

From the repository root:

```sh
npm ci
npm ci --prefix playground
npm --prefix playground run dev
```

Fill in the providers you use in the root `.env`; see [`.env.example`](../.env.example).
Open the URL printed by Vite. After editing catalog data, run
`npm run aimodels:build`.

| Page | Route | What it tests |
| --- | --- | --- |
| Playground | `/` | ChatAgent, providers, tools, message inspection |
| Voice | `/speech` | Recorded transcription and text-to-speech |
| Realtime | `/realtime` | Streaming STT → selected LLM → TTS, interruptions, optional camera |
| Live voice | `/speech-to-speech` | OpenAI Realtime, Gemini Live, xAI Voice, Azure Voice Live, Nova Sonic |

## Providers and models

Keys stay on the playground server. **Providers & Models** selects chat
providers and models from the bundled catalog. Realtime shares the language
settings and adds independent STT and TTS controls.

Model precedence is the browser's explicit selection, then a provider's `.env`
override, then the playground default. **Use default** clears a saved model
choice. Chat/Realtime preferences live in browser storage under
`provider-settings`; credentials are read from `.env`.

Default models and provider options are defined in
[provider-config.ts](src/lib/provider-config.ts),
[realtime-speech.ts](src/lib/server/realtime-speech.ts), and
[speech-to-speech-sessions.ts](src/lib/server/speech-to-speech-sessions.ts).
The playground defaults are separate from library constructor defaults.
Changing `.env` restarts the dev server; reload the page to refresh its settings.

## Voice setup

- OpenAI speech uses `OPENAI_API_KEY`.
- Deepgram Flux transcription uses `DEEPGRAM_API_KEY`.
- ElevenLabs uses `ELEVENLABS_API_KEY`; `ELEVENLABS_VOICE_ID` sets the initial
  synthesis voice. Realtime can also list available voices from the account.
- Gemini Live uses `GOOGLE_API_KEY`; xAI uses `XAI_API_KEY`.
- Azure needs `AZURE_VOICE_LIVE_ENDPOINT` and an API key or access token.
- Nova uses the AWS SDK credential chain. Export `AWS_PROFILE` in the shell when
  using a named profile; the SDK does not read it from the playground `.env`.
  Running `npm ci` at the repository root installs the SDK used here.

The [environment template](../.env.example) lists model/voice overrides and
other optional settings. Provider and model controls lock during live sessions.

For Gemini, select **Live voice → Gemini Live → Connect microphone**. The default
is `gemini-3.8-live`, voice `Kore`, with the detection settings used by the
[live voice test](../tests/speech/gemini-live.integration.test.ts): high start/end
sensitivity, 300 ms prefix padding, and 500 ms silence to finish a turn.

## Transport and diagnostics

The browser captures microphone audio, resamples it, plays PCM, and displays
transcripts and timing. Provider sessions and tools run on the server. HTTPS
with HTTP/2 or HTTP/3 supports a framed streaming upload; plain HTTP development
uses ordered PCM posts. The server returns framed events and audio.

Timing measures server arrival and processing, not billing or words actually
heard. Realtime camera input starts disabled. Enable it when a turn needs vision.
Session registries are in memory and expire lazily when requests inspect them;
this app is a local testing tool, not a production session service.

## Validate

```sh
npm run check:playground
```

This builds the catalog, runs Svelte/TypeScript checks and playground tests,
and creates a production build against the local AIWrapper source.
