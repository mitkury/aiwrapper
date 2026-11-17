# Rust cascade voice sessions

Status: proposed; implementation has not started.

Last updated: November 17, 2026.

The [framework source review](rust-cascade-source-review.md) records the inspected
LiveKit Agents, Pipecat, and Gradbot revisions and the findings behind this design.

## Goal

Build a reusable Rust voice pipeline and make it testable in AIWrapper's browser
playground before integrating it into other applications:

```text
microphone PCM → streaming STT + turn detection → text/image LLM → streaming TTS → speaker
```

The speech-to-text, language, and text-to-speech providers must be independently
replaceable. The pipeline should support tools, transcripts, text input, camera
context, interruption, and history corrected to the audio actually played.
Compare its latency with native live models in the same test harness. Comparable
latency is a target to measure, not a prerequisite we can promise in advance.

Implementation is Rust-only. Existing TypeScript code can inform protocol tests,
but extending it or maintaining a second cascade implementation is not part of
this proposal. Browser media and interface code remain host adapters, not an
implementation of the agent pipeline.

## Starting point

The initial design inspected `feat/native` at
`ce2e80d59ce53df6f47c25ddc449920afcce6125`. The native runtime has since merged;
implementation starts from `main` at
`aa72b6c` (native crate 0.2.1), which also provides usage callbacks and silent tools.

The [native guide at that revision](https://github.com/mitkury/aiwrapper/blob/ce2e80d59ce53df6f47c25ddc449920afcce6125/docs/native.md)
describes the existing foundations:

- `native/src/live.rs`: `LiveSession`, cloneable `LiveSender`, `LiveReceiver`, and
  normalized `LiveEvent`s for Gemini and OpenAI.
- `native/src/live-agent.rs`: `LiveAgent`, an ordered tool worker with bounded
  queues, cancellation, persistence callbacks, and connection replacement.
- `LanguageProvider::complete`: one model round with streamed message snapshots;
  it returns tool requests without executing handlers.
- `Conversation`, `Compression`, and `MockLang`: neutral history, optional request
  compression, and deterministic language-model fixtures.
- `native/src/speech.rs`: batch transcription and HTTP PCM synthesis, but no
  continuous transcription or streaming text-input synthesis.
- `native/examples/sandbox.rs`: a Rust chat example used by the browser
  playground. Its current per-request process cannot own a continuous voice
  session; the speech and live pages currently use TypeScript providers.

Two details affect the design. `LiveSender` and `LiveReceiver` contain concrete
socket state, and `LiveAgent::replace` accesses that state directly. Backend
dispatch alone will not make the agent backend-independent. Also,
`ResponseEnded` means one model response ended, not that all tools, synthesis,
or device playback have completed. Preserve that distinction.

## Decision and scope

Add a cascade backend returning the same `LiveSession` used by native live
models. Keep `LiveAgent` as the sole automatic tool executor. The cascade calls
`LanguageProvider::complete` directly rather than nesting a `ChatAgent` with a
second tool loop.

Use a separate `CascadeConfig` containing injected providers, initial history,
instructions, tool declarations, limits, cancellation, and optional compression.
Do not squeeze three providers and credentials into `LiveConfig`'s single model,
key, and socket settings. Factory and trait names below are proposed, not shipped
APIs.

Internally, give sender and receiver a socket-or-cascade backend. Extract the
small internal operations that `LiveAgent` needs for pending calls, retirement,
and resumption; keep provider protocol state inside the socket backend. Preserve
existing method signatures where possible and test both live providers through
the refactor. Do not add a general plugin registry or workflow framework.

The first useful release includes a continuous Rust pipeline, real speech
providers, tools, explicit Stop, conservative speech interruption, playback
accounting, latest-frame vision, and the browser test path. Speculation, semantic
backchannel classification, local turn models, automatic recovery, and additional
providers come after that path is reliable.

AIWrapper owns inference orchestration. Hosts own devices, resampling, playback,
echo cancellation, network transport to clients, credentials, permissions,
persistence, and recording. No WebRTC or audio-device dependency enters the
crate. A cascade does not hear tone or non-speech sounds, or understand continuous
video; use a native live model when those inputs matter.

## Streaming speech contracts

Reuse `PcmFrame`: mono signed 16-bit PCM with an explicit sample rate. Each adapter
declares accepted input or produced output formats and rejects incompatible
frames. The host resamples. Do not assume every TTS provider produces 24 kHz.

Streaming STT needs a session that accepts PCM while the caller polls events,
supports explicit end-of-input and cancellation, and reports failures even when
no input operation is pending. Events carry stable utterance IDs and transcript
revisions, with distinct speech-start, interim transcript, final transcript,
and committed-turn meanings. A final transcription segment is not necessarily
the end of a conversational turn. Duplicate finals must not start duplicate
responses.

Configure one authority for committed turns: provider events initially, manual
commit for deterministic tests, and a local detector later. Do not combine a
provider endpoint with a second silence timeout that independently starts
responses. Speech observations and interruption policy remain separate. Retain
audio sample offsets when available so acoustic speech end is distinguishable
from the later turn decision. A missing final transcript must produce a bounded,
observable timeout, not an indefinite wait or an invented user message.

Start with Deepgram Flux provider turn events. Preserve eager-end and resumed
events in the adapter, but leave speculative generation disabled initially.
The [Flux documentation](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot)
describes eager-end, resumed, and confirmed-end events; eager events require an
explicit threshold. Verify supported models and languages in integration tests.
An explicit commit must have a bounded completion rule. If a provider cannot
force finalization, expose that limitation instead of waiting forever or treating
an interim transcript as final.

Streaming TTS accepts text, flushes a segment, ends one synthesis input, and can
be cancelled independently of the conversation. It emits PCM and optional
alignment metadata. Start with ElevenLabs streaming input and a fallback that
wraps existing HTTP synthesis, one bounded text segment at a time. Preserve
output order and limit concurrent requests and queued PCM.

ElevenLabs documents character alignment and connection inactivity limits in
its [streaming-input protocol](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input).
Normalize alignment against a response's cumulative sample timeline and retain
the mapping between submitted text and provider-normalized spoken text. Treat
alignment as provider evidence, not proof of playback or perfect word accuracy.
Do not promise one TTS socket for the entire conversation: ending input can end
the stream. Initially open synthesis per response; add prewarming or reusable
contexts only where the provider supports them and measurements justify them.

Keep STT open across turns. Provide an injected speech transport supporting
binary PCM and text/control messages. The existing JSON-only `LiveTransport`
cannot directly represent raw STT frames. Reuse networking dependencies, while
keeping the speech protocol boundary explicit and testable.

Use a small text segmenter with sentence punctuation, CJK punctuation, clause
boundaries, a length cap, and a maximum wait before flushing buffered text.
Tune a shorter first segment and larger later segments using measured latency
and speech quality. Speak only assistant-visible text, never reasoning or tool
arguments. Adapt cumulative LLM snapshots into deltas without replaying already
spoken text; a non-prefix revision requires explicit handling, not appending the
whole replacement as another delta.

## Session behavior

| Existing surface | Cascade behavior |
| --- | --- |
| `append_audio` | Feed the persistent STT session; enforce format and queue limits. |
| `end_audio` | Finish pending microphone input with bounded finalization; later input may resume. |
| `append_image` | Replace the latest camera frame without making a model request. |
| `send_text(..., false)` | Add context without generating a reply. |
| `send_text(..., true)` | Commit input and request a response, retiring current response work first. |
| `send_realtime_text` | Commit typed user activity and interrupt current output. |
| `send_tool_results` | Validate call IDs/names, append accepted results and images, then continue once the round's results are resolved. |
| `interrupt` | Invalidate active response work before cancellation; harmless when idle. |
| `truncate_audio` | Apply the host's cumulative playback position to the identified audio part and conversation text. |
| `input_sample_rate` | Report the configured STT input rate. |
| `resumption` | Return no provider resumption handle. |
| `close` | Cancel owned work and close speech sessions with bounded cleanup. |

STT supplies input transcripts. Committed LLM rounds emit `ResponseStarted`,
output text transcripts, tool calls, and `ResponseEnded`. TTS emits identified
`Audio` parts. Output text events describe generated text; they must not imply
that the text was spoken or heard. Preserve the existing response-end meaning
and expose separate synthesis-complete and playback-complete observations in
the cascade diagnostics. Tool results can start another model round in the
same user turn.

Use session-unique call IDs across rounds. Validate a result batch before
accepting any of it; reject unknown, duplicate, or mismatched results and suppress
cancelled deliveries. The cascade never runs handlers itself. `LiveAgent` keeps
its existing execution and persistence guarantees, including outcomes arriving
after cancellation. Do not invent a successful or cancelled tool outcome to
repair history. Keep unresolved work explicit and reconcile it before a request
that requires a complete tool group. STT can continue receiving input meanwhile.

Preserve the current Rust `ToolDefinition::silent` behavior: record the result
without prompting a follow-up response. Test mixed silent/non-silent calls
against the existing live contract; do not couple silence to a tool's name.

## Cancellation, interruption, and playback

Each response has a monotonically increasing generation, separate from
`LiveAgent`'s conversation generation. Every LLM update, TTS write/read, queued
event, and history mutation checks it. Invalidate first, cancel second. Late
callbacks must neither emit stale audio nor change current history. Use bounded
channels and deadlines; cancellation must remain responsive when a consumer is
slow. Synchronous model callbacks must not block on a full async queue: use a
bounded handoff and fail/cancel the response on overflow.

Cancellation, close, and turn decisions must remain deliverable when audio or
speculative text fills a queue. Give control work a separate bounded path or
equivalent priority, while preserving per-response ordering. Bound both queued
items and queued audio duration; a frame count alone does not cap latency.

Explicit Stop confirms an interruption immediately. For speech, distinguish a
candidate from a confirmed interruption. Initially provide an immediate mode
and an optional sustained-speech threshold, configured by the host. A first
interim word or duration threshold alone does not reliably identify backchannels.
Do not claim that short affirmations are understood or filtered semantically.

Candidate observations use a separate diagnostic/policy hook; they must not
emit the existing `SpeechStarted` or `Interrupted` signals that hosts already
use to clear playback. On confirmation emit the interruption-facing events once,
cancel the generation and pending tool delivery, and ask the host to clear its
queue. The default policy can confirm immediately. A host may pause or defer a
cut during a candidate, then resume on rejection; the library must not discard
generation or audio merely because a candidate occurred. Prototype that policy
in the playground before extracting a standalone detector API, consistent with
the [interruption proposal](interruption-detection.md).

Expose host playback capabilities explicitly, including whether pause/resume is
supported. A pending turn decision must settle before a false-interruption timer
can resume speech. A new committed turn or teardown always cancels that resume.
Bound the pause and retained-audio budget; if either expires, stop the response
and reconcile its playback instead of accumulating indefinitely. Pausing the
speaker is not permission to leave LLM/TTS queues unbounded.

Every audio part has a stable item ID and content index, including fallback
segments. The browser reports cumulative played samples converted to
milliseconds, excluding padding and queued audio. Stop must work even after
generation and synthesis have finished but playback remains queued.

Use `truncate_audio` for cuts and add a narrow playback-progress/finalization
hook for normal playback. The session needs both to distinguish generated,
delivered, and played text. Finalize the old playback position before starting
a new model request; the playground should send the cut acknowledgement and
new input in order. Hosts that provide no cursor get generated history only,
with no claim that it represents what was heard.

Bound the acknowledgement wait. If the player disconnects or misses its deadline,
mark playback unresolved and stop the affected turn rather than silently treating
all sent audio as heard. Test a response that never reached the player: a prior
audio part's completion must not finalize the new response.

With reliable alignment, retain only fully played text spans. Without it, retain
the last fully played segment; for unaligned continuous output, conservatively
treat that output as one segment. Preserve the generated tail only in optional
diagnostics. Repeated cursor reports must be idempotent, scoped to their original
session/item, and validated against emitted duration. Never grow a message after
it has been cut.

## History, vision, and failures

The cascade owns a `Conversation`, can start from supplied history, and exposes
snapshots and completed-message/playback-correction callbacks for host
persistence. Credentials, handlers, and transports are not serialized. Keep
generated text separate from the playback-confirmed projection used after an
interruption. Preserve real tool outcomes independently of spoken prose.

Before editing assistant text or pruning image items, address the existing
native replay issue: provider `Message.meta` can preserve an older raw message.
An edited neutral message must not replay the removed text or images through
stale metadata. Preserve required opaque signatures where valid, and reject an
unsupported edit explicitly. This is a prerequisite for correct truncation,
not a later cleanup.

At user-turn commit, snapshot the newest image. Keep idle camera frames out of
requests. Remove older camera and tool images from the model request projection,
not the host's durable history; retain their text and tool/result relationships.
Validate image and tool-image support for the chosen LLM and reject unsupported
combinations clearly. Do not advertise every text model as vision-capable.

Use the existing optional `Compression` on complete, reconciled history groups.
Playback edits invalidate checkpoints covering changed text; rebuild or reject
those checkpoints using the existing digest validation. Never summarize an
unresolved tool group or speculative turn.

The initial release reports a failed turn or terminal speech-session failure
explicitly, retains known history/outcomes, and lets the host reconnect. No
silent audio replay, tool replay, or automatic retry after partial delivery.
LLM/TTS failure must not mark unplayed output as heard. Later, bounded speech
reconnection may preserve the conversation, but lost microphone audio and
partially synthesized output need an explicit recovery policy. A cascade emits
no model `Resumption` or `Expiring` event. Terminal closure is reported once;
local close and receiver drop stop all owned tasks without cancelling the host's
parent token.

## Test it in the browser

Browser testing is a required deliverable, not a downstream integration task.
Extend AIWrapper's existing playground with a Rust-backed cascade mode. Reuse
its microphone, PCM player, camera, and controls where practical. A persistent
Rust example host owns the session across audio uploads, events, text, tool
results, and playback acknowledgements. Keep that host outside the library and
reuse one core for both the example and direct Rust embedding.

The interface must visibly identify the Rust runtime and offer:

- independent STT, LLM, TTS, model, voice, and language controls, locked while
  connected; a deterministic mock option without keys;
- Connect, Disconnect, microphone mute/end-input, typed input, and Stop;
- microphone input and streamed speaker output, with actual playback tracking;
- input/output transcripts, tool activity, errors, and response/playback status;
- optional camera preview, disabled initially, and a latest-frame test;
- side-by-side timing summaries for cascade and native Gemini/OpenAI runs;
- explicit configuration errors, with no fallback to TypeScript inference.

Credentials stay in the host environment. Browser capture, resampling, playback,
and optional echo cancellation use the existing host boundary. Changing the
runtime requires a persistent native voice bridge, not just adding a picker
entry to the current TypeScript realtime route. Disconnect or page departure
must close the native session; the example host must bound idle sessions.

Document a single launch command and required environment variables once the
host exists. Acceptance includes running that command from a clean checkout,
speaking several turns, using a tool, interrupting during playback, resuming
conversation with corrected history, and disconnecting without leaked tasks.
Browser code may remain TypeScript; no TypeScript STT/LLM/TTS pipeline is required.

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

## Implementation order and acceptance

1. Refactor live backend internals without changing native provider behavior.
   Add deterministic compatibility checks for sender cloning, receiver polling,
   event ordering, tools, replacement, cancellation, and close.
2. Add Rust streaming speech contracts, scripted STT/TTS mocks, bounded
   segmentation, and the cascade over `LanguageProvider`. Prove overlapping
   LLM/TTS, tools through `LiveAgent`, cancellation fencing, and history behavior.
   Resolve replay-metadata handling before claiming playback-correct history.
3. Implement Deepgram Flux and ElevenLabs adapters plus the HTTP TTS fallback.
   Test formats, transcript revisions, turn boundaries, alignment, flush/end,
   asynchronous errors, and abort through injected transports.
4. Add the persistent native example host and browser mode. Include playback
   acknowledgements, Stop, basic interruption, tools, text, and camera testing.
   Run credential-backed smoke checks and record a comparable live-model
   baseline. This is the first release gate, not an optional demo.
5. Add the session inspector above, with live events and stopped-session timeline
   review, image sampling evidence, and exact request snapshots.
6. Tune interruption policy and first-audio latency from recorded sessions.
   Add speculation only after the baseline path passes and the benefit exceeds
   its extra calls and cancellation cost.

Offline tests must cover repeated transcript IDs; final segments versus turns;
text arriving before an STT final; simultaneous input and tool completion;
streaming before the LLM finishes; CJK and unpunctuated text; ordered fallback
audio; cancellation before first audio and after synthesis but during playback;
late callbacks; bounded-queue overflow; partial provider failure; completed tool
side effects after cancellation; malformed/manual tool results; accurate and
conservative truncation; stale replay metadata; image pruning; and repeated
close/drop. Use a simulated clock and playback cursor, with no credentials or
physical audio device.

Also test a full audio queue during cancellation, missing final transcription,
missing playback acknowledgement, a committed turn racing false-interruption
resume, and teardown during a pause. When speculation is added, cover a verdict
before the first model event, confirmation during tool argument streaming, a
matching final after the speculative deadline, and changed tools or instructions.

Real-provider tests remain opt-in. Browser checks additionally exercise device
permission failures, echo-prone playback, false speech candidates, pause/resume
if enabled, reconnect, and clean teardown. Existing Gemini/OpenAI tests must
continue to pass. No runtime tests or latency results are claimed by this
proposal itself.

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
Avoid an ONNX dependency until a selected local model demonstrates a benefit.
A second real STT provider should prove the no-provider-turn-events path before
that capability is advertised; mocks alone cannot establish its quality.

A standalone Rust realtime-agent API would avoid touching live internals, but
would make hosts maintain two tool and session integrations. The shared
`LiveSession` surface avoids a second public integration, though the internal
refactor still needs compatibility tests.

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
