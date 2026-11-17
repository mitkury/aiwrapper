# Rust cascade voice sessions: remaining work

Status: the first testable Rust pipeline and browser host are implemented.
Last updated: November 17, 2026.

Current APIs, launch instructions, tested providers and limitations are in the
[Rust cascade guide](../../native-cascade.md). This proposal contains follow-up
work; it is not a claim that every design below is implemented. The
[framework source review](rust-cascade-source-review.md) records the inspected
LiveKit Agents, Pipecat, and Gradbot revisions and the reasoning behind the design.

## Direction

Keep Rust as the sole inference and agent runtime. TypeScript can supply browser
interfaces and thin clients. Reuse `LiveSession`, its handles, and `LiveAgent` as
the only automatic tool executor. Call `LanguageProvider` directly from the
cascade. Avoid a second nested agent loop, plugin registry, or workflow engine.

Hosts own devices, resampling, echo cancellation, playback, credentials,
permissions, persistence and client transports. The example process bridge is a
local test adapter. Optional hosting and WebRTC remain later work over the same
embeddable Rust core. No audio-device or WebRTC dependency enters the library.

## Remaining speech and lifecycle work

The first version keeps Flux open across turns and streams bounded HTTP synthesis
segments. Extend it only where the browser tests show a need:

- Add ElevenLabs streaming text input with flush/end, cancellation and normalized
  alignment. Preserve submitted-to-spoken text mappings and audio sample offsets.
  Provider alignment is evidence about synthesis, not proof of playback.
- Add an injected binary/text speech socket boundary and deterministic transport
  fixtures for handshake failure, failed/abandoned writes, remote close, and
  finalization races. The existing JSON-only `LiveTransport` is insufficient for
  raw STT PCM. Keep networking dependencies shared.
- Refine segmentation with measured first/later segment sizes and maximum wait.
  Preserve Unicode and non-prefix revision errors. Measure request count and
  speech quality before replacing the working HTTP fallback.
- Expose richer transcript revisions and acoustic sample offsets. Keep final
  transcript segments distinct from confirmed turns. Add an explicit bounded
  wait for forced finalization, handling the provider's no-active-turn warning.
  Do not promote an interim transcript to final on timeout.
- Prove a second STT provider without native turn events before advertising that
  path. Mocks cannot establish end-of-turn quality.

Immediate speech interruption is the initial policy. Later, distinguish a
candidate from a confirmed interruption. Candidate observations must not emit
`SpeechStarted` or `Interrupted`, which hosts already use to clear playback.
Prototype sustained-speech or semantic decisions in the playground before
extracting another detector API. Short affirmations are not automatically noise.

Expose host pause/resume capabilities only when needed. A committed turn or
teardown cancels every pending resume. Bound retained audio and pause time; on
expiry, stop and reconcile playback. Add race fixtures for an interruption during
synthesis, a full audio queue, late provider callbacks, and a failed consumer.

## Playback, history and vision follow-up

The first version conservatively keeps fully acknowledged segments after a cut.
Add a distinct normal-playback finalization hook and an explicit acknowledgement
handshake before a replacement model request. Bound the wait; missing acknowledgements
must remain unresolved, not be treated as heard. Do not allow a prior audio part's
completion to finalize a new response. Test delayed cursors and repeated reports,
including Stop after synthesis has finished but playback is still queued.

Playback edits currently synchronize known provider text replay fields and reject
signed Gemini text edits. General message editing still needs stale-`meta`
detection, serialization fixtures and an explicit supported-edit policy. Preserve
opaque reasoning/signatures when valid; reject unsupported edits rather than
replaying deleted text or discarding required signatures.

Add optional `Compression` only on complete history groups. Playback edits must
invalidate affected checkpoints. Keep full durable history apart from compressed
request projections. Preserve actual tool outcomes through interruption; unresolved
tool groups must never be repaired with invented results.

Camera frames currently use latest-at-turn-commit semantics. Extend request
projection to prune old tool-result images as well as old camera images. Retain
text, tool/result pairing, image provenance and durable history. Test supported
vision models and reject unsupported image combinations explicitly.

## Measurement and diagnostics

Record correlated session, turn, response, tool, and audio-part IDs. The Rust
timeline uses one monotonic clock for audio receipt, detected speech end, final
transcript, LLM request, first token, first TTS text, first PCM, and terminal
outcome. Distinguish observed acoustic speech end from the later provider turn
decision. Fixed audio fixtures supply a known speech-end sample for benchmarks.

Measure speech end to first delivered PCM in the Rust harness, and separately
speech end to first played PCM in the browser. Browser and server clocks are
different: do not subtract raw timestamps across them. Use a single-clock
fixture test or explicit clock correlation, and label provider-estimated speech
end and server-arrival proxies honestly. Compare native live models through
the same host, player, audio fixture, network conditions, and output criterion.

Report sample count, p50/p95 latency, failures, cold/warm connections, model and
voice settings, tool turns, and image/no-image cases. Check answer and speech
quality alongside speed. Store the method and results in an AIWrapper testing
document when measurements exist; do not import vendor latency numbers as a
baseline. Do not assume STT or TTS is a negligible share of total latency.

Expose optional diagnostic events and provider usage with explicit units:
tokens, synthesized characters, and audio duration where available. Count
cancelled/speculative work and mark estimates as estimates. Pricing tables and
account billing belong to the host. Raw prompts, audio, and transcripts are
opt-in diagnostics; metadata is enough for the default timing trace.

## Session inspector after the first working pipeline

The next browser milestone is a simple inspector for understanding a real
session. While connected, show incoming and outgoing events as they happen.
Stop ends the live connection but preserves its trace for review. Use a timeline,
a chronological event list, and a selected-event detail pane. Avoid decorative
charts or a second settings dashboard.

Show microphone/STT activity, transcript revisions, committed user turns, LLM
requests and streamed output, tool calls/results, TTS input/audio, playback,
interruptions, and failures. Distinguish generated, sent, and played output.
Selecting an LLM request shows the actual request snapshot, including instructions,
history after compression/pruning, tools, and attached images. Provider-wire
payload inspection may be enabled separately; always remove credentials and
authentication headers. Do not reconstruct requests later from mutated history.

For a camera or other video source, show capture and sampling timestamps, frame
IDs and previews, which frames were replaced/skipped, and the exact frame attached
to each request. Distinguish camera images from tool-result images. Link image
events to their originating source, user turn, and request. This must make it
possible to answer “why did the model see this frame?” without reading server logs.

Define stable trace IDs and versioned events during the first implementation so
the viewer does not need a runtime rewrite. Capture payloads only when inspection
is explicitly enabled; keep ordinary diagnostics as metadata. Use bounded host
storage, visible dropped-event/retention markers, and explicit clear/export
controls. A stopped session remains available until cleared or its documented
retention limit is reached. Record each clock's origin and correlation quality;
do not imply precise ordering across unsynchronized browser/server clocks.

Acceptance: connect, speak and show a changing video input, interrupt an answer,
then stop and inspect the complete sequence. The viewer must show the selected
frame and actual LLM request for each turn, distinguish unplayed audio, and expose
errors or missing trace data clearly. Test the same inspection flow with mocks.
The first pipeline can ship before this viewer; the viewer precedes latency
optimizations and is the main tool for subsequent manual testing.

## Next acceptance milestones

1. Use the first browser pipeline for multiple spoken turns, tool execution,
   camera input, Stop during playback and reconnect. Record device/permission,
   echo and provider failures; keep deterministic tests separate from live calls.
2. Implement the session inspector below before latency optimization. Establish
   trace IDs, opt-in payload capture, retention markers and request/image links.
3. Measure native-live and cascade baselines in the same harness. Choose the next
   speech or interruption change from those results.

Keep sender cloning, receiver cancellation, tool replacement and Gemini/OpenAI
compatibility tests green. Offline cascade coverage should grow to include queue
saturation, missing finalization, input/tool completion races, image pruning,
checkpoint invalidation, slow playback, and full trace retention flows.

## Later work and alternatives

Speculative generation starts on eager end of turn using a private conversation
snapshot. It may buffer bounded text and tool requests, but cannot execute tools,
send text to TTS, publish reply text, or commit history before confirmation.
Promote only if utterance ID, transcript revision, context revision, and image
snapshot still match, including instructions, tool declarations, and tool choice.
Initially require exact transcript matching; any later normalization is an
explicit policy with its own tests. Otherwise discard it and run the committed
turn. Resumed speech, new text/context, interruption, and close invalidate it.
Bound speculation by time and buffered bytes/items. Expiry releases no output;
a later confirmed turn starts fresh inference. Keep the final user transcript
out of the speculative snapshot's durable history. Speculative TTS is a later,
separately measured option, not required for LLM speculation.

Other later work: an optional local VAD/end-of-turn adapter, semantic backchannel
classification, additional speech providers, and measured connection reuse.
Optional Rust agent hosting and WebRTC connections can follow the working
cascade and inspector, using the same embeddable core with transports at the
host boundary; see the [migration direction](native-rust.md#webrtc-and-frontend-integration).
Avoid an ONNX dependency until a selected local model demonstrates a benefit.
A second real STT provider should prove the no-provider-turn-events path before
that capability is advertised; mocks alone cannot establish its quality.

A standalone Rust realtime-agent API would avoid touching live internals, but
would make hosts maintain two tool and session integrations. The shared
`LiveSession` surface avoids a second public integration, with compatibility tests covering the internal
backend boundary.

LiveKit supports custom audio I/O and Pipecat supports multiple transports; neither
should be rejected as inherently tied to one hosted transport. Their inspected
orchestration runtimes are Python, so adoption would add a runtime/service boundary
instead of extending the embeddable Rust crate. Gradbot offers a Rust core but
uses concrete Gradium speech clients and its own LLM/history/tool contracts.
Use their patterns and race tests as described in the source review. Reconsider
full framework adoption if the Rust embedding requirement changes.

Direct audio input to text LLMs, talker/reasoner splitting, filler speech, speaker
identification, and a new recording system are outside this proposal.

Decisions to make from tests: initial LLM/model and voice defaults, required STT
languages, interruption thresholds, acceptable latency/quality tradeoffs, and
whether provider alignment is good enough to improve on segment-level cuts.
