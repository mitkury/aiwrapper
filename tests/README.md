# Tests

The suite contains deterministic unit tests and credential-gated provider integration tests.

## Commands

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:all
npm run test:lang
npm run test:tools
npm run test:agents
npm run test:speech
npm run test:img-in
npm run test:img-out
```

`npm test` builds first and runs deterministic unit tests. Files ending in `.integration.test.ts` use live providers and are excluded from the default test command.

The complete integration command runs files sequentially to reduce provider
rate-limit failures. Use `PROVIDERS` to narrow the run when debugging one or a
small group of providers.

`npm run check:playground` type-checks and production-builds the Svelte browser
playground against the local AIWrapper source.

Use `PROVIDERS` to limit integration tests:

```bash
PROVIDERS=openai npx vitest run tests/lang/basic-lang.integration.test.ts
PROVIDERS=openai,anthropic npm run test:tools
```

Provider tests are skipped when the corresponding API key is absent. A present but expired or invalid key still causes a provider failure.

Speech integration tests use `OPENAI_API_KEY` for an OpenAI TTS-to-STT
round trip. The ElevenLabs streaming test requires both `ELEVENLABS_API_KEY`
and `ELEVENLABS_VOICE_ID`. Limit a run with `PROVIDERS=openai` or
`PROVIDERS=elevenlabs`.

Speech-to-speech unit tests use injected WebSockets for OpenAI Realtime, Gemini
Live, xAI Voice, and Azure Voice Live, plus an injected bidirectional stream for
Amazon Nova Sonic. Protocol translation, PCM formats, events, abort, and close
behavior therefore remain deterministic and credential-free.

The Gemini Live smoke tests use `GOOGLE_API_KEY` and default to
`gemini-3.8-live` (override with `GEMINI_LIVE_MODEL`). Run them with:

```bash
npm run build
PROVIDERS=google npx vitest run tests/speech/gemini-live.integration.test.ts
```

The voice test streams a checked-in [speech fixture](speech/fixtures/README.md)
in 20 ms packets, ends microphone input, and repeats on the same connection.
Voice detection settings are explicit, including a 500 ms end-of-speech silence
threshold, so the fixture does not depend on the provider's current defaults.
Each turn must produce nonempty input and spoken-output transcripts, at least
100 ms of 24 kHz mono PCM with a non-silent signal, and a response-end event.
It sends no text prompt to trigger the response. Each turn has a 30-second
deadline; provider errors fail the test and the connection is always closed.
Failure diagnostics report transcript lengths and audio/turn progress.

There is no model judge, exact-word assertion, or live TTS dependency. This
checks the voice protocol round trip, not answer quality, intelligibility,
physical audio devices, or an application's WebRTC transport. The separate
tool test sends a synthetic image, conversation context and an
application-owned tool result, then checks for spoken output.

These tests make real, potentially billable provider calls and remain outside
the default deterministic suite. Run only the voice check with:

```bash
PROVIDERS=google npx vitest run tests/speech/gemini-live.integration.test.ts -t 'transcribes streamed speech'
```

## Model check

Use `test:model` for one catalog entry:

```bash
MODEL=<model-id> npm run test:model
MODEL="<model-id>@<provider>" npm run test:model
```

The model test selects checks from the bundled AIModels catalog. See
[working with AIModels](../docs/dev/aimodels.md) to test catalog edits directly
from the submodule without publishing them to npm.

## Generated files

Image-output tests may write generated images under `tests/img-out`. Those files are ignored and should not be committed.
