# AbortController for LanguageProvider — Brief Proposal

## Goal
Allow callers to cancel in-flight `ask/chat` calls by passing an `AbortSignal` through `LangOptions`, without breaking existing provider behavior or streaming callbacks.

## Context
- `LangOptions` currently lacks any cancellation mechanism; streaming loops run until server completion.
- Providers use `httpRequestWithRetry` + `processServerEvents`; neither layer accepts a `signal` yet.
- Users have asked about passing an AbortController token via provider options.

## Proposal
1. Add `signal?: AbortSignal` to `LangOptions` and thread it through provider-specific request builders.
2. Update `httpRequestWithRetry` and `processServerEvents` to accept and forward `signal` to the underlying `fetch`/reader so aborts stop retries and close SSE streams.
3. Ensure `onResult` callbacks are not fired after abort; surface an `AbortError` immediately (skip retries/backoff) so callers can distinguish user-initiated cancel vs. failures.
4. Document a minimal usage snippet: `const ac = new AbortController(); lang.chat(msgs, { signal: ac.signal, onResult }); ac.abort();`

## Alternatives
- Provide a `cancel()` handle on the returned `LangMessages` or a dedicated request object; more ergonomic but requires new stateful wrapper.
- Add a timeout helper (e.g., `timeoutMs` in options) that internally uses AbortController; simpler API but less flexible than caller-managed signals.
- Expose provider-specific cancellers (per request ID) for long-running or multi-call flows; heavier design, likely overkill now.

## Behavior Details
- Request-level only (v1): a single abort cancels the whole chat/ask request and underlying stream.
- Tool calls: treat as incomplete on abort—do not auto-execute or commit tool results after abort fires. Keep any partial messages collected so far in the `LangMessages` instance for inspection, mark the result with `aborted: true`, and surface `AbortError`.
