# Completing the native Rust runtime

Status: the first Rust implementation exists in `native/`. This proposal covers
remaining migration work. Implemented APIs, integration examples and the current
compatibility matrix are in the [native runtime guide](../../native.md).

## Direction

Make Rust a first-class embedding target, eventually covering the existing
runtime features with a smaller implementation. Keep the npm package usable
while native compatibility is established. Do not require a Node process,
separate AIWrapper server, frontend framework or application-specific service.

The first version establishes three boundaries: neutral conversation values,
provider protocol translation, and a tool loop. Hosts supply credentials, tools,
persistence, networking overrides and frontend transport. An injected HTTP
request/stream interface and an injected live JSON socket cover host-managed
networking without a service framework. Default implementations provide HTTPS
and WebSockets. Native Rust callers use the crate directly.

Consolidate related protocols: OpenAI-compatible providers should remain endpoint
presets over one adapter. Keep Responses, Anthropic, Gemini, Ollama and Cohere
translations explicit. Do not abstract away real differences in signed reasoning,
image tool results, provider-owned tools or live interruption semantics.

## Remaining feature migration

1. Add optional AWS adapters for Bedrock ConverseStream and Nova Sonic. Reuse the
   official Rust AWS SDK for credential chains, SigV4, retries and event streams;
   do not reproduce AWS signing. Keep this dependency out of builds that do not
   use AWS. Translate to the same messages and live events.
2. Port realtime STT for OpenAI, Deepgram Flux and ElevenLabs, followed by
   incremental ElevenLabs TTS. Retain explicit sample rates, bounded buffers,
   utterance commit rules and observable transport errors.
3. Port continuous STT → LLM → TTS orchestration. Compose the existing Rust chat
   agent with streaming speech, bounded text segmentation and cancellation.
   Handle barge-in without replaying tool side effects. Playback cursors remain
   host-owned. A turn-based transcription demo alone would not be parity.
4. Add xAI and Azure live presets/protocol differences over the shared socket
   boundary. Preserve manual tool delivery, connection errors and truncation
   capabilities explicitly. Test each protocol before advertising compatibility.
5. Finish image generation's standalone facade, the patch helper and a small
   model-catalog interface. Generate model data from the existing catalog source;
   avoid a second manually maintained model list. Keep catalog capabilities as
   hints rather than claims of account access.
6. Adapt the playground's speech and live routes to a native example host. Keep
   all listeners, session registries and browser transport outside the library.
   Chat already exercises the native runtime through the existing host route.

## Tighten conversation replay

Conversation replay needs a focused follow-up before broader adoption:

Assistant messages contain both neutral items and raw provider replay data in
`meta`. The raw form preserves signatures and encrypted reasoning, but currently
takes precedence even after a caller edits the neutral items. This gives one
message two competing sources of truth. First detect edited messages and reject
stale replay data explicitly; then retain only the opaque provider fields that
cannot be reconstructed. Cover edits, serialization and signed tool replay
before changing the persisted format.

## Compression belongs in the reusable runtime

Text history compression and native-live context management are different.
The first Rust version adds optional text compression to the agent: full durable
history stays intact, while model requests use a summary plus recent complete
message groups. Hosts can persist checkpoints before they take effect. A digest
prevents applying a checkpoint to unrelated or edited history.

Next, support optional exact token estimators or catalog-informed budgets only
where callers need them. Keep conservative estimation as the default. Consider
an explicit retry after a verified context rejection, but only before any
streamed output or tool execution. Never turn a network failure into a replay.

For live sessions, preserve provider compression/resumption controls and expose
lifecycle events. Do not run text summarization over an active audio stream or
claim that queued audio was heard. Application playback and persistence must
provide that evidence.

## WebRTC and frontend integration

WebRTC belongs to the host media layer. It decodes microphone audio to PCM and
encodes model PCM for playback; it also owns signaling, ICE, authentication,
resampling and pacing. AIWrapper's live interface accepts PCM and emits events,
so the same crate works with WebRTC, an application WebSocket or local audio.
Adding libwebrtc or a WebRTC server to the core would make every embedding host
pay for a transport it may not use.

An existing Rust server can map the serializable agent events to its own HTTP,
SSE or WebSocket endpoints. Keep authorization and tool permissions there. A
frontend should send a model choice and conversation input, not API keys, trusted
instructions, arbitrary outbound URLs or executable tool definitions.

## Dependency and size policy

Prefer established Rust libraries for TLS, sockets, JSON, schema validation and
AWS signing. The first version replaces the JavaScript fetch/ws/AJV stack with
reqwest, tokio-tungstenite, serde_json and jsonschema. Use serde values or optional
host-side schemars instead of duplicating Zod. Reject malformed structured output
rather than carrying a permissive JSON repair layer across languages.

Compare authored runtime source separately from generated catalogs, tests,
examples, lockfiles and dependencies. The first version is already smaller than
the TypeScript runtime, but it implements fewer features; that is not a completed
parity benchmark. Measure release binary size, startup and concurrent sessions
once voice parity is in place. Rust will not remove remote provider latency.

Keep code size under review as ports land. Remove duplicate adapters and old
migration scaffolding after compatibility is proven, rather than adding a generic
provider framework. Native bindings for npm are optional future work: first
establish the Rust API and retain the working TypeScript distribution.

## Acceptance before calling the migration complete

Every advertised provider needs deterministic protocol fixtures, cancellation
and failure coverage, plus a separately run credential-backed smoke test.
Agent tests must prove that completed side effects survive cancellation and that
resumption cannot silently execute a tool twice. Compression tests must cover
large histories, tool-group boundaries, persistence failures, changed history and
oversized latest input. Voice tests must include setup rejection, binary/text
frames, interruption, tool cancellation, disconnects and reconnect handoff.

Keep npm/package and playground checks green alongside Cargo formatting, Clippy
and tests. Exercise a separate Rust consumer through a path or Git dependency,
and test the packaged crate without the JavaScript sources. Move each completed
piece into normal usage documentation and remove it from this proposal.
