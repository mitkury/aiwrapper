# Proposal: Streaming-Only Architecture Across Providers

## Overview
Adopt a streaming-only internal architecture for all providers. Each provider should always request and process streaming responses internally and build the final `LangMessages` the same way, regardless of whether the caller supplies `onResult`. This consolidates logic, reduces divergence, and improves reliability.

## Providers in Scope
- Anthropic (already migrated)
- OpenAI (Chat Completions)
- OpenAI (Responses API)
- Google (Gemini)
- Groq (OpenAI-compatible)
- DeepSeek (OpenAI-compatible)
- Cohere
- Ollama
- OpenRouter (OpenAI-compatible)

## Problems Today
- **Dual code paths**: Several providers maintain both streaming and non-streaming logic (or special branches), duplicating parsing and message-building.
- **Drift risk**: Fixes often need to be applied twice; bugs appear when one path lags.
- **Complex tests**: Every feature must be validated in both modes.
- **Latency illusion**: Non-streaming offers no latency benefit; we already need to parse and assemble the same structures.

## Principles
- **Always stream**: Set `stream: true` (or API-specific streaming toggles) for all providers internally.
- **One code path**: Parse deltas and events, update `LangMessages`, and emit `onResult` if provided; otherwise just accumulate.
- **Tool-first**: Accumulate tool calls during streaming; finalize arguments from partial JSON and emit a consolidated tool-call message once complete.
- **Finish consistently**: Mark `result.finished = true` and auto-execute tools, emitting tool-results via `onResult` if provided.
- **Better errors**: Centralize and improve error mapping per provider; keep retry logic via `httpRequestWithRetry`.

## Provider-Specific Notes

### Anthropic (Done)
- Status: Implemented. Always `stream: true`; removed non-streaming code and dead helpers.
- Stream events: `content_block_*`, `message_*`; accumulate tool args via `partial_json` and index mapping.

### OpenAI (Chat Completions)
- Current: Dual path with `isStreaming`; non-streaming parses `choices[0].message` and `tool_calls`.
- Change:
  - Always request with `stream: true` and `Accept: text/event-stream`.
  - Remove non-streaming branch; rely solely on `handleStreamData`.
  - Ensure tool-calls are reflected progressively: track `{ id, name, arguments }` buffers per tool id; parse JSON incrementally.
  - Preserve reasoning fields if available (delta.reasoning_content) like in DeepSeek override.

### OpenAI (Responses API)
- Current: Already optimized for streaming when `onResult` is provided; also has non-streaming path.
- Change:
  - Always stream. Use previous_response_id optimization but stream in both primary and fallback.
  - Remove non-streaming final parse, keeping only the streaming event router `handleStreamingEvent`.

### Google (Gemini)
- Current: Uses SSE endpoint `:streamGenerateContent?alt=sse` always; internally streams even without `onResult`.
- Change:
  - Keep streaming, but do not emit `(options?.onResult as any)?.(result)` with the whole result object on each chunk; prefer emitting the incremental `msg` when available for consistency with others.
  - Ensure tool function calls are collected as `tool` messages and arguments merged from parts; currently emits immediate tool message with `{ callId: name }` which is not stable; switch to stable ids if available.

### Groq (OpenAI-compatible)
- Current: Has explicit non-streaming branch when no `onResult`.
- Change:
  - Remove non-streaming branch; always stream using OpenAI-compatible deltas.
  - Reuse OpenAI path for tool call accumulation and reasoning/thinking extraction.

### DeepSeek (OpenAI-compatible)
- Current: Inherits OpenAI and overrides reasoning deltas; already streaming-first when `onResult`.
- Change:
  - Ensure always streaming. Keep special handling for `reasoning_content`.

### Cohere
- Current: Already streaming with `stream: true` and SSE; limited functionality.
- Change:
  - Keep streaming-only; standardize end-of-stream finalization and tool execution.

### Ollama
- Current: TBD (check existing code). Align to streaming-only path where supported; otherwise simulate consistent incremental handling.

## Refactor Plan

1. **Common patterns**
   - Extract a small helper for partial JSON accumulation per tool id (provider-agnostic utility):
     - `accumulateJsonChunk(map: Map<string, { name: string; buffer: string }>, id: string, chunk: string): Record<string, any> | null`
   - Provide minimal typed discriminated unions for each provider’s stream events to reduce `any` usage.

2. **Provider edits**
   - Anthropic: done.
   - OpenAI Chat Completions: remove non-streaming branch; always set stream headers; route through `processResponseStream` and `handleStreamData` only.
   - OpenAI Responses: always stream; drop non-streaming fallback; keep previous_response optimization but stream.
   - Groq: remove non-streaming path; stream via inherited handler.
   - DeepSeek: ensure streaming is unconditional; keep reasoning handling.
   - Google: emit incremental message parts (not entire result) for consistency; keep SSE endpoint.
   - Cohere, Ollama: ensure streaming-only flow and consistent finalization.

3. **Testing**
   - Update tests to rely on the same behavior for both modes; non-streaming tests become “no onResult but still streams internally”.
   - Keep provider filters via `PROVIDERS=...`.

4. **Docs**
   - One doc describing streaming-only philosophy, migration notes (no breaking changes), and examples of using/omitting `onResult`.

## Risks & Mitigations
- **Provider without streaming**: Provide a shim that reads the full response but still routes through a synthetic streaming processor to keep code path unified.
- **Tool argument parsing errors**: Use incremental JSON parsing with try/catch; finalize at `*_stop` events; warn but don’t throw.
- **Reasoning formats**: Normalize provider-specific reasoning deltas into `appendToAssistantThinking`.

## Acceptance Criteria
- Non-Anthropic providers do not branch on `isStreaming` in `chat()`.
- All providers finalize with `result.finished = true` and auto tool execution.
- Basic and agents tests pass per provider when credentials are available.
