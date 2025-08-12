### Refactor completion checklist (WIP)

- **Structured output & schema handling**
  - [ ] Implement JSON Schema validation in `src/lang/schema/schema-utils.ts` (currently returns a placeholder). Decide on validator and wire it in `validateAgainstSchema`.
  - [ ] In `askForObject` flow, when `options.schema` is provided:
    - [ ] For providers that support native structured output, set provider-specific request options (e.g., OpenAI `response_format` with `json_object` / `json_schema`).
    - [ ] For others, augment prompt using `addInstructionAboutSchema` from `src/lang/prompt-for-json.ts`.
    - [ ] On completion, parse to object (use `src/lang/json/extract-json.ts` as fallback) and validate via Zod or JSON Schema; populate `LangResult.object` and collect validation errors.
  - [ ] Add robust error reporting for schema validation failures (aggregate errors in `LangResult`).

- **Streaming pipeline**
  - [ ] Generalize `src/lang/process-lines-from-stream.ts` beyond OpenAI SSE format (`data: ...` and `[DONE]`). Detect content-type and support other providers’ formats and JSON newline streams.
  - [ ] Implement `LangResult.abort()` with `AbortController` and propagate through `http-request.ts` and `processResponseStream`.
  - [ ] Verify Node streaming compatibility and update the comment in `src/process-response-stream.ts` if Node support is confirmed.

- **Tools support**
  - [x] Improve streaming parsing of `tool_calls` (handle partial/incremental JSON arguments safely instead of naive `JSON.parse` per delta). Implemented in `src/lang/openai-like/openai-like-lang.ts` with buffer accumulation and finalization on stream end.
  - [x] Add mock provider support to simulate streaming `tool_calls` via `mockToolCalls` in `src/lang/mock/mock-openai-like-lang.ts`.
  - [x] Add a test covering partial argument assembly in `tests/tools.test.ts`.
  - [ ] Provider-specific `formatTools` overrides and request wiring (Anthropic, Google, Cohere, Mistral, OpenRouter).
  - [ ] Provide helper workflow for executing tools externally and merging results via `LangResult.addToolUseMessage`, plus examples and docs.

- **Providers**
  - [ ] Ensure schema-aware request formatting per provider (enable native structured output where available).
  - [ ] Review and normalize role mapping (e.g., OpenAI `system` → `developer` or `user` for o1 models) across providers.
  - [ ] Audit retry and error handling pathways using `http-request.ts` `httpRequestWithRetry` for each provider.

- **Tests (Vitest)**
  - [ ] Add tests for `askForObject` with Zod schemas (simple and nested) and with JSON Schema.
  - [ ] Add streaming tests (ensure incremental `answer`, final `finished`, object parsing & validation).
  - [ ] Add tests for `validateAgainstSchema` (Zod and JSON Schema) and `extract-json` edge cases.
  - [ ] Migrate or rewrite essential cases from `tests-old/` to `tests/`.
  - [x] Add tests for tool call detection and argument assembly during streaming.

- **Documentation**
  - [ ] Update README structured output section once JSON Schema validation is implemented and providers support native formats.
  - [ ] Document `askForObject` behavior for Zod vs JSON Schema, including error surfaces and types.
  - [ ] Add provider-specific notes for structured output and tools.
  - [ ] Document `abort()` API and streaming caveats.

- **Developer experience & CI**
  - [ ] Add `.env.example` for tests and clarify required keys in `docs/testing.md`.
  - [ ] Include newly added docs in `.airul.json` `sources` and regenerate `.cursorrules`.
  - [ ] Ensure CI runs schema/object tests with a mock provider or recorded fixtures when no API key is present.

- **Cleanup**
  - [ ] Remove inline TODOs after implementation in:
    - `src/lang/prompt-for-json.ts`
    - `src/lang/process-lines-from-stream.ts`
    - `src/lang/schema/schema-utils.ts`
    - `src/lang/language-provider.ts` (`abort`)
  - [ ] Confirm `extract-json` is used in non-native structured flows and gate verbose logging behind an option.

### Notes from recent commits
- API redesign toward unified `LangResult` and `askForObject` with Zod support is in progress.
- Migration to Vitest complete; legacy tests under `tests-old/` are excluded and need porting.
- JSON output and new API with Zod are marked WIP; structured output must be finalized across providers.