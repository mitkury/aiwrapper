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

Speech-to-speech unit tests use injected WebSockets for OpenAI Realtime and
Gemini Live, so protocol translation, PCM formats, events, abort, and close
behavior remain deterministic and credential-free.

## Model check

Use `test:model` for one catalog entry:

```bash
MODEL=<model-id> npm run test:model
MODEL="<model-id>@<provider>" npm run test:model
```

The model test selects checks from the capabilities stored in `aimodels`. See [docs/dev/aimodels-linking.md](../docs/dev/aimodels-linking.md) to test unpublished catalog changes.

## Generated files

Image-output tests may write generated images under `tests/img-out`. Those files are ignored and should not be committed.
