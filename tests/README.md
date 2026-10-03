# Tests

`npm test` builds the package and runs deterministic unit tests. Live provider
checks end in `.integration.test.ts` and are excluded from that default suite.

## Commands

| Command | Scope |
| --- | --- |
| `npm run test:unit` | Unit tests without rebuilding |
| `npm run test:integration` | Build, then live tests sequentially to reduce rate limits |
| `npm run test:all` | Unit and integration suites |
| `npm run test:lang`, `test:tools`, `test:agents`, `test:speech` | Build, then the named suite, including live tests |
| `npm run test:img-in`, `test:img-out` | Image input or output checks |
| `npm run check` | Build, unit tests, and a clean package-consumer check |
| `npm run check:playground` | Playground type check and production build |

Integration tests use real, potentially billable calls. Missing credentials
skip the corresponding tests; invalid or expired credentials cause failures.
Filter providers or run a specific file after building:

```sh
npm run build
PROVIDERS=openai npx vitest run tests/lang/basic-lang.integration.test.ts
PROVIDERS=openai,anthropic npm run test:tools
```

Use `MODEL=<model-id>@<provider> npm run test:model` to check a catalog entry;
the provider suffix is optional. See [AIModels](../docs/dev/aimodels.md) for
local catalog edits. Generated images under `tests/img-out` are ignored.

## Speech checks

Unit tests inject WebSockets or bidirectional streams to check provider
protocols, PCM formats, events, abort, and close without credentials.
OpenAI TTS-to-STT integration uses `OPENAI_API_KEY`; ElevenLabs streaming uses
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Select either with `PROVIDERS`.

Gemini Live checks require `GOOGLE_API_KEY` and default to `gemini-3.8-live`;
set `GEMINI_LIVE_MODEL` to override it:

```sh
PROVIDERS=google npx vitest run tests/speech/gemini-live.integration.test.ts
```

The voice check sends a fixed [speech fixture](speech/fixtures/README.md) in
20 ms packets twice on one connection, with explicit VAD settings and no text
trigger. Each turn must produce nonempty input and output transcripts, at least
100 ms of non-silent 24 kHz mono PCM, and a response-end event within 30 seconds.
Errors fail the test; diagnostics report transcript lengths and turn progress.
A separate check sends an image, context, and an application-owned tool result
and expects spoken output. Both close their connections.

To run only voice, append `-t 'transcribes streamed speech'`. These are protocol
checks without a model judge or exact-word assertions; they do not evaluate
answer quality, physical audio devices, or an application's media transport.

OpenAI Realtime has the same two-turn PCM check plus an image/context/manual-tool
check in `tests/speech/openai-live.integration.test.ts`, plus a Stop/truncation
check that verifies the provider acknowledgement and spoken output on the next turn. It uses `OPENAI_API_KEY`,
`PROVIDERS=openai`, and `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`). The
voice fixture is resampled to 24 kHz by the test, outside the provider adapter.

## Language-test helpers

[lang-gatherer.ts](utils/lang-gatherer.ts) selects configured providers and
supports `modelOverrides`, `providers`, and `overrideProviders`. `PROVIDERS`
has final authority; `overrideProviders` is intersected with it. Environment
variables such as `OPENAI_MODEL` set models unless overridden in code.

- `gatherLangs()` returns `LanguageProvider[]`.
- `gatherLangsWithNames()` returns `{ name, lang }[]`.
- `createLangTestRunner(callback, options?)` registers a suite per provider;
  the callback receives the provider and defines its tests.

See [a language test](lang/basic-lang.integration.test.ts) for usage. Supported
providers and defaults live in the helper rather than a second provider list.
