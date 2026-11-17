# Session debugging: existing tools and useful patterns

Status: research for the proposed inspector; no integration implemented.
Reviewed: November 17, 2026.

## Recommendation

Build the first inspector in the existing browser playground, with Rust emitting
correlated events and the browser contributing device and playback observations.
Borrow LiveKit's synchronized session view and Whisker's selectable event paths
and shared live/file format. Consider Langfuse as an optional trace destination
later. A new voice framework or hosted runtime is unnecessary for this milestone.

The reviewed material does not establish a ready-made solution for our whole
requirement: live I/O, retained review after Stop, exact model requests, camera
sampling decisions, and browser playback acknowledgements. This is a limit of
this review, not a claim that no product can support those features.

## What exists

| Solution | Verified capabilities | Fit and limits for AIWrapper |
| --- | --- | --- |
| [LiveKit Agent Console](https://docs.livekit.io/testing/agent-console/) | Live events, tool execution, timing, audio waveforms, and hidden observation of sessions. | Strong reference for live debugging. Documented agent integrations are LiveKit SDK integrations, not an arbitrary Rust event collector. |
| [LiveKit Agent Insights](https://docs.livekit.io/testing/observability/insights/) | One timeline for transcripts, recordings, traces, logs, and metrics. Traces/logs arrive during sessions; transcripts/audio become available after the session. | Agents can run elsewhere, but Insights requires LiveKit Cloud media servers. Not available for entirely self-hosted media deployments. |
| [Pipecat Whisker](https://github.com/pipecat-ai/whisker) | Local browser debugger with processor/frame inspection, event filtering, frame paths, and saved sessions. | Closest source reference for a small local developer inspector. Backend instrumentation follows Pipecat's Python worker/frame model. |
| [Langfuse sessions](https://langfuse.com/docs/observability/features/sessions) and [multimodality](https://langfuse.com/docs/observability/features/multi-modality) | Groups traces into conversations; supports image, audio, video, and other media attachments. Self-hosted media storage needs object storage configuration. | Useful for request/tool traces and artifact handling. Reviewed docs do not establish a synchronized camera-sampling or browser-playout view. |
| [Retell call records](https://docs.retellai.com/api-references/get-call) | Post-call recordings, separate participant audio channels, timed transcripts/tool calls, and logs of LLM WebSocket requests/responses and turn latency. | Useful reference for exportable session evidence. API belongs to Retell calls; not a generic local Rust debugger. |

The Console and Insights are complementary: a live waveform/event inspector is
not the same capability as a finalized recording aligned with conversation
history. Neither should be described as proof of sound reaching a user's ears.

## What source inspection adds

These checkouts were inspected, not installed or executed. No account, cloud
session, media upload, or browser interaction with these products was tested.
Product behavior above comes from official documentation; observations below
come from the pinned source. Existing framework architecture research is in the
[source review](rust-cascade-source-review.md).

| Repository | Inspected revision |
| --- | --- |
| LiveKit Agents | [`0cfc0306335cc8b3633ec2cdce072a3f340cb14e`](https://github.com/livekit/agents/tree/0cfc0306335cc8b3633ec2cdce072a3f340cb14e) |
| Pipecat | [`6203e080683aaaaf49d4f801d75eb22526ee0a68`](https://github.com/pipecat-ai/pipecat/tree/6203e080683aaaaf49d4f801d75eb22526ee0a68) |
| Whisker | [`dc715047d829bb26fce29defa68bf72c8ee4c9d3`](https://github.com/pipecat-ai/whisker/tree/dc715047d829bb26fce29defa68bf72c8ee4c9d3) |

**Whisker:** its [sink and serializer](https://github.com/pipecat-ai/whisker/blob/dc715047d829bb26fce29defa68bf72c8ee4c9d3/pipecat/src/pipecat_whisker/sink.py)
exclude raw input/output audio and speaking frames by default. The serializer
turns unsupported values, including bytes, into type labels and requests
truncated large values from LLM context. Therefore a visible frame payload is
not automatically a complete media artifact or exact provider request.
Pipecat's [debug log observer](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/observers/loggers/debug_log_observer.py)
also excludes binary media fields. A Pipecat “frame” is a pipeline message,
not necessarily a camera frame.

Whisker's [file sink](https://github.com/pipecat-ai/whisker/blob/dc715047d829bb26fce29defa68bf72c8ee4c9d3/pipecat/src/pipecat_whisker/file.py)
writes a starting snapshot followed by MessagePack events using the live wire
format. Its [frame-path view](https://github.com/pipecat-ai/whisker/blob/dc715047d829bb26fce29defa68bf72c8ee4c9d3/ui/src/components/FramePath.tsx)
orders observations of a selected frame through processors. Those are useful
patterns without adopting its worker graph. A Rust protocol adapter might reuse
the UI, but would need compatibility work and new media/provenance behavior;
it is not a turnkey Rust integration.

**LiveKit:** [AgentSession recording options](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/livekit-agents/livekit/agents/voice/agent_session.py)
separate audio, transcripts, traces, and logs. An optional `input_delta` stores
only changed model-input context with references to earlier spans. This saves
telemetry volume but makes faithful inspection dependent on retaining the
referenced spans. Prefer self-contained request snapshots for our first viewer.
LiveKit's [session traces](https://docs.livekit.io/reference/agents/session-traces/)
also offer a useful stage-span vocabulary for later telemetry export.

**Langfuse:** its [SDK guidance](https://langfuse.com/docs/observability/sdk/overview)
explicitly supports other languages through OpenTelemetry and lists Rust OTel.
This gives Rust a practical export route without adding a TypeScript inference
layer. Use the [supported OTel ingestion path](https://langfuse.com/docs/api-and-data-platform/features/public-api),
not a new integration with the deprecated legacy trace-ingestion API. No Rust
exporter or media-upload integration was tested in this research.

## Proposed first inspector

Keep the acceptance criteria in the [cascade proposal](rust-cascade-agent.md#session-inspector-after-the-first-working-pipeline).
The following choices make those criteria concrete without expanding the UI:

1. **One event model for live and review.** Append versioned events with session,
   turn, request, response, tool, frame, and audio-part identifiers where relevant.
   Stop closes the session but retains its events. Import/export uses the same
   representation. Reviewing a session must never re-execute tools or API calls.
2. **A timeline, event list, and detail pane.** Filter by input/output or stage;
   clicking an event exposes its payload and linked events. Start with these
   controls, not a worker graph, evaluation dashboard, or administrative console.
3. **Exact request snapshots.** Capture the actual projected model input before
   dispatch: instructions, history, tools, and image references. Keep this apart
   from later mutated history. Optional provider-wire inspection must redact
   credentials; truncated or missing content must be visibly labelled.
4. **An explicit image trail.** Store source/frame IDs, capture and sampling
   times, dimensions, artifact hashes/previews, replacement/skipping decisions,
   and the request IDs that included each frame. A thumbnail alone does not
   explain why a frame was selected. Distinguish camera and tool-result images.
5. **Separate synthesis from playback.** Track text submitted to TTS, generated
   audio, delivery, queueing, browser-reported played offsets, cancellation,
   and unresolved acknowledgements. Keep microphone and assistant recordings
   separate. A generated recording or provider alignment is not playback proof.
6. **Honest timing and retention.** Use monotonic times within each process;
   record clock origins and correlation uncertainty across browser/server.
   Bound artifact/event storage and show dropped-event or evicted-artifact gaps.
   Keep payload capture opt-in and make Clear and Export explicit.

The Rust runtime supplies request and orchestration evidence; the host supplies
capture, transport, and player evidence. Keep telemetry optional and bounded so
inspection cannot stall the voice path. An OTel adapter can later export stage
spans and artifact references, while the local event stream retains device-level
details that general tracing UIs do not automatically understand.

## What to defer and how to validate

Defer adopting a hosted debugger, porting Whisker's worker model, and adding
multiple observability backends. This loses their existing graphs, sharing, and
analytics initially, but keeps the first deliverable focused on explaining a
single local session with the providers already supported.

Before selecting any integration, compare it with one recorded fixture: two
spoken turns, changing camera input, a skipped frame, a tool result, interrupted
speech, missing playback acknowledgement, and Stop. Verify that review identifies
the exact image/model request and unplayed audio, including missing evidence.
That exercise should decide whether an existing UI saves work; documentation
and source inspection alone do not establish that it meets these requirements.
