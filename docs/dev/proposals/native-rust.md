# Rust backend and thin clients

Status: proposal · updated November 17, 2026. This replaces the earlier feature-by-feature
porting plan. Current behavior and provider coverage are in the [native guide](../../native.md).

## Where we are

The playground already runs inference, tools, speech and agent sessions in Rust.
It still needs a Node/SvelteKit server to read configuration, validate requests,
launch Rust subprocesses and relay streams. Chat also imports message classes
and types from the old TypeScript runtime, and model selection imports its catalog.
The separate TypeScript provider/agent library still ships; removing the bridge
alone would not retire it.

## Proposed shape

| Part | Responsibility |
| --- | --- |
| Rust crate | Providers, messages, tool execution, conversation state, cascade/live orchestration, cancellation and diagnostics. Embed directly in any Rust backend. |
| Rust host example | Run the same crate behind HTTP and WebSocket endpoints. Own credentials, session lifetimes, request limits and application integration. Start with one runnable example; extract a reusable hosting crate only when needed. |
| Thin JavaScript client | Typed requests/events, connection lifecycle, streaming and cancellation. Optional browser helpers capture media, resample audio, play output and report what actually played. |
| Playground | UI, simulator, permissions, timeline and request inspection. Use the client as an ordinary consumer. |

The client owns no provider protocols, server tools, model history or provider
keys. Keep UI/simulator code out of it. Rust applications need neither this client
nor Node bindings or a WASM runtime.

Existing Rust backends supply their own authentication, tools and persistence.
The example host starts on loopback; remote hosting needs application authorization
and tool policy. Editable prompts and raw payloads remain explicit debug features.

## Small migration steps

1. **Make the client boundary independent.** Use plain serializable message/event
   values instead of importing `LangMessage`/`LangMessages` or root package types.
   Get models/configuration from Rust. Extract the client from working playground
   calls rather than designing an SDK framework.
2. **Replace the development bridge.** Build one Rust host example with streamed
   HTTP chat/speech and a WebSocket per live/cascade session. Import the crate
   directly instead of spawning a process per request. Preserve session IDs,
   request/frame inspection, playback acknowledgements and cancellation. Use a
   small versioned wire protocol. Vite can proxy to Rust during development; built
   static assets must work without a Node server.
3. **Switch the playground and remove old paths.** Delete SvelteKit API handlers,
   server configuration loaders, subprocess adapters and their launch plumbing
   after the Rust host passes the same flows. Node may remain an asset-build and
   test tool. Separately retire `src/` provider/agent code and its package build
   once frontend imports and supported integrations no longer depend on it.

Keep existing npm releases available. The client needs a new package or explicit
major-version migration; it is not a drop-in provider-library replacement.

## Scope decisions before deletion

Do not port every old feature automatically. Use the [compatibility matrix](../../native.md#compatibility-and-remaining-work)
to decide which gaps need a Rust implementation and which to retire: AWS Bedrock/
Nova Sonic, additional live/STT adapters, incremental TTS, standalone image helpers
and the patch helper. Document those decisions before dropping the corresponding
TypeScript APIs. Keep existing Rust-supported Chat, Voice, Cascade, Simulator and
Live voice working throughout.

Remove duplication and fix behavior rather than reorganizing code for appearance.
One larger issue still needs separate work:
raw provider replay metadata can override edited neutral messages. Detect or
reconcile those edits before presenting persisted conversations as freely editable.

## WebRTC and frontend integration

Start with HTTP/WebSocket to replace the bridge directly. WebRTC can later adapt
the same PCM/frame session interface. Keep signaling and media routing outside
the core. A server crate, durable recovery and remote tool execution can wait.

## Done when

A separate Rust application can embed the crate without JavaScript. The built
playground runs all five supported pages against Rust with no Node backend or
imports from the retired runtime. Tests cover tools (including `keep_silent`),
provider failures, cancellation/reconnect, interrupted history, bounded media and
matching request/frame inspection. Keep deterministic protocol tests and optional
real-provider smoke tests separate. Delete replaced code as each step passes;
do not maintain parallel inference implementations.
