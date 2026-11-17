# Bounded visual context and a room simulator

Status: proposed. Updated November 17, 2026.

## Problem and first experiment

Cascade currently attaches only the latest camera frame. A user asking about an
object they passed seconds ago cannot rely on the image still being available.
Appending every image forever would instead make latency, context and memory grow.

Add an optional Rust-owned recent-frame policy alongside the existing latest-frame
policy. Capture roughly one frame per second. At each committed user turn, select
at most 12 timestamped images since the previous turn: up to six from the last six
seconds, then evenly spaced images from the earlier interval. Unused recent slots
may be used for earlier images. Always prioritize the latest eligible frame.
Retain at most five minutes, 300 frames and 32 MiB of encoded image data. Cap a
request's selected images at 4 MiB; show when limits remove coverage. These are
initial experiment settings, not benchmark-derived optimal values.

Use capture timestamps from one host session clock, validate monotonic input, and
also expire frames against runtime receipt time. Never represent receipt time as
capture time. Existing append_image clients can use explicitly labeled receipt
timestamps. Freeze selection at turn commit so later camera input cannot change a
queued turn or tool continuation. Expire old camera attachments from conversation
storage, while preserving text, tool results and caller-supplied images.

The feature is short visual context, not durable memory. Old frame references
alone do not let a provider retrieve images. Provider-managed state, summaries,
retrieval and long-term retention remain separate follow-up work.

## Research and alternatives

Reviewed November 17, 2026:

- [OpenAI's video example](https://developers.openai.com/cookbook/examples/gpt_with_vision_for_video_understanding)
  sends sampled frames as multiple images in a request. This supports the basic
  mechanism; it does not establish an ideal sampling budget for live agents.
- [Gemini Live video input](https://aistudio.google.com/docs/live-api/capabilities#send-video)
  accepts individual JPEG/PNG images at up to one frame per second. Its
  [streaming protocol](https://ai.google.dev/api/live#BidiGenerateContentRealtimeInput)
  processes input incrementally. Our turn-time batching is a different scheduling
  policy, not a claim to reproduce Google's internal model architecture.
- [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
  documents static one-FPS sampling and warns about missing fast action. Frame
  timestamps and explicit gaps matter; this is not continuous motion tracking.
- [SVMemAgent](https://arxiv.org/abs/2609.18540) investigates learned online frame
  replacement without knowing future questions. Useful motivation for later
  selection experiments, but a trained selector is unnecessary for this baseline.

Separate images preserve per-frame detail and references. Contact sheets may
reduce detail and do not guarantee lower token costs. Start with separate images.
Uniform sampling is easy to reproduce but can miss brief events. A recent-only
window loses earlier context. Use a recent-plus-spread baseline before considering
perceptual deduplication or scene-change selection. No embeddings or extra model
calls in the first implementation.

## Browser experiment

Add a small walkable 3D gallery as an alternative to the webcam, using procedural
geometry, colored exhibits and readable labels. Use keyboard movement, drag-to-look
and visible controls, with a resettable starting point. Keep inference in Rust;
TypeScript only renders the room, captures images and displays diagnostics.

Only rendered camera images and user inputs reach the model. Scene object names,
coordinates and hidden state must not enter the prompt. Include distinct views
and an occluding partition so looking away is a meaningful test. Keep simulator
capture running while the assistant speaks. Use the same sampling and request
path as a webcam, with typed input for permission-free tests.

Show the Rust-selected frames for each request, with IDs/times and previews,
separately from the live view. Retain a bounded review history after disconnect,
with visible retention limits. Show request selection counts and omitted/expired
coverage. A full session recorder is outside this change.

## Verification

Deterministic Rust tests cover short and long intervals, timestamp spacing,
latest-frame inclusion, age/count/byte limits, no duplicate selection, stale
frames, invalid timestamps, turn boundaries, tool continuation and image pruning.
Browser checks cover moving/looking/resetting, sampling a rendered frame, inspecting
the actual selected request images, disconnect retention and reconnect cleanup.
Offline mode proves plumbing only. A separate real-provider test should ask what
is visible now, then look away and ask about the earlier view. Compare latest-only
and recent-history modes; do not imply that one successful reply proves memory
quality. Run native and playground checks before publishing.
