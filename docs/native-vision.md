# Camera context and the 3D simulator

Cascade can attach a bounded batch of camera frames when a user turn commits.
Selection, retention and request construction run in Rust. Browsers supply
rendered images and capture timestamps; there is no TypeScript inference or
frame-selection backend.

## Try the room

Run `npm run sandbox:native` and open `/simulator` in the playground.

1. Open **Session settings** to choose a vision-capable model and speech
   output. **Recent history** is selected by default; choose **Latest frame
   only** for comparison. Keys stay in the server's `.env`.
2. Press **Start session**. The simulator sends the rendered view once per second.
   Capture continues during assistant speech. Nothing is sent before connecting.
3. Click the room. Use W/A/S/D to move, drag to look, or left/right arrows to turn.
   Visible buttons provide the same controls. **Reset view** restores the starting
   camera; it does not erase the current session's captured history.
4. Speak naturally, or type in the conversation panel. The microphone is on by
   default; the browser requests access only after **Start session**. Toggle
   **Mic on** off before starting if you want typed input only. The simulated
   camera needs no webcam permission. Speech input uses
   Deepgram; typed input does not need a transcription key.
5. Expand **Turn timeline** under **Configure & inspect** to review response timing
   alongside the selected frames. **Frames sent to the model** provides the
   dedicated image inspector. It displays the exact images attached to each Rust request, with IDs, capture times, selection counts and evictions.
   **End session** stops capture but retains the review. Starting again clears it.
   Click a frame thumbnail to inspect it at full size; Escape closes the preview.

The room contains colored exhibits, readable labels and a partition that hides
one view from another. Only pixels and your input reach the model: object lists,
positions, collision geometry and hidden scene state are not included in prompts.
Walk past something, turn away, then ask what you passed. One-FPS sampling can
miss a brief view; the inspector makes that failure visible.

**Offline test** runs real Rust selection and tools with mock language output and
a short tone. It does not recognize objects. Use a configured vision model for
actual visual understanding. `tool: add {"a":2,"b":3}` also works with frames.
When `DEEPGRAM_API_KEY` is missing, Cascade starts in typed offline mode. To
speak in the same room using `GOOGLE_API_KEY`, select **Talk in this room with
Gemini Live**, then **Start session** and allow microphone access. Gemini handles
voice and room images on its live connection. For the Cascade pipeline, configure
Deepgram for transcription and choose Deepgram Aura, OpenAI or ElevenLabs for speech output.
Open `/simulator?tts=deepgram` to select Flux input and Aura output with the same key.

The room requires WebGL 2; no downloaded models or external image assets are used.

The same visual-input selector offers a webcam on `/cascade`. Gemini Live can
also receive room images, but sends them continuously through the provider's live
protocol instead of using Cascade's batch selection. The batch inspector is for
Cascade requests.

## Selection policy

The library defaults to `CameraContext::Latest` for compatibility. The playground
selects `Recent` by default. Capture frequency and selected-image count are
separate settings: the current browser captures one 640-pixel-wide JPEG per second.

At each committed turn, `Recent` considers frames received since the previous
turn, within the retention window:

- With at most 12 candidates, include all, subject to the byte budget.
- Otherwise, reserve up to six frames from the last six seconds. Include the
  latest available frame even if capture has paused.
- Fill remaining slots with frames nearest evenly spaced timestamps across the
  remaining interval. Selection uses timestamps, not array positions. Return
  the selected images in chronological order, without duplicates.
- If no new frame arrived, reuse the latest retained frame and explicitly mark
  `reusedLatest`. A frame older than the retention window is not reused.

| Limit | Behavior |
| --- | --- |
| Five minutes, 300 frames, 32 MiB encoded image data | Evict oldest buffered frames when any limit is reached |
| 2 MiB encoded data per image | Reject oversized input |
| 12 selected images, 4 MiB encoded image data per request | Prefer newer selected frames when the byte budget is exhausted |
| 8 inspected requests, 16 MiB image data in the browser | Remove oldest inspected requests and display a removed-request count |

These budgets are starting points for experiments, not measured optima. Large
images can shorten temporal coverage. The inspector distinguishes candidates
omitted by sampling/size from frames evicted from the input buffer. Capture times
remain visible so gaps cannot be confused with continuous motion.

Selection freezes at turn commit, including turns waiting on a tool. Tool
continuations see that same batch. On later turns the runtime removes old camera
images and their timestamp captions from conversation storage; original user
text, caller-supplied images and tool results remain. Historical camera selection
metadata remains, marked `pruned`. This avoids retaining many copies of the camera
stream in conversation history.

This is short-term visual context. It is not permanent visual memory: historical
frame IDs do not let a provider fetch images that have been removed. Earlier
assistant text can still contain observations, but the underlying pixels are no
longer attached. Provider token cost depends on the model and image resolution;
multiple JPEG attachments do not have the same accounting as a video-file API.

## Rust integration

```rust,no_run
use aiwrapper::live::{CameraContext, CameraFrame, LiveImage};

// Given a CascadeConfig and JPEG data supplied by your host:
config.camera_context = CameraContext::Recent;
let session = config.connect()?;
session.sender.append_camera_frame(&CameraFrame {
    id: 1,
    captured_at_ms: 1_000,
    image: LiveImage { data: jpeg_base64, mime_type: "image/jpeg".into() },
}).await?;
```

IDs must strictly increase. Capture timestamps must be nondecreasing and come
from one host session clock; use a new session if that clock resets. Legacy
`append_image` input gets runtime-generated IDs and explicitly labeled receipt
rather than capture timestamps. Do not mix the two clock types within a session.
Runtime receipt age also expires stale frames, independently of host timestamps.
`append_camera_frame` is Cascade-specific; native live sessions use `append_image`.

Each image is preceded in model input by its frame ID and session-relative time.
`image-received` events carry capture/receipt provenance. `request.camera` carries
selection metadata when `config.capture_requests` is enabled.
`request.conversation` holds the exact neutral message
projection with images. This is not the provider's final wire encoding. Frame
metadata is stored under the reserved `Message.meta.cascadeCamera` key.

## Research and validation

Reviewed November 17, 2026:

- [OpenAI's video example](https://developers.openai.com/cookbook/examples/gpt_with_vision_for_video_understanding)
  demonstrates sampled images in a single request. It does not prescribe an
  optimal sampling budget for conversational agents.
- [Gemini Live](https://aistudio.google.com/docs/live-api/capabilities#send-video)
  accepts individual JPEG/PNG frames at up to one FPS; its
  [protocol](https://ai.google.dev/api/live#BidiGenerateContentRealtimeInput)
  processes input incrementally before a turn ends. Cascade batches images at
  turn commit; this does not reproduce Google's undisclosed model internals.
- [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
  documents static one-FPS sampling and the risk of missing rapid action.
- [SVMemAgent](https://arxiv.org/abs/2609.18540) explores learned online frame
  replacement. That is a useful future comparison, not a dependency of this
  deterministic baseline.

Separate images keep individual frame references and detail. Contact sheets can
reduce small-text readability and do not guarantee lower costs. Scene-change
selection, retrieval and provider-managed state remain [future work](dev/proposals/visual-context.md).

Run `npm run native:check`, `npm run native:test:cascade`, and
`npm run check:playground`. Deterministic tests cover timestamp spacing, short and
long gaps, age/count/byte limits, invalid input order, latest-frame behavior,
freezing through tool calls and preserving unrelated images while pruning.

Local Chrome checks exercised movement/reset, distinct rendered captures, exact
request previews, disconnect retention, reconnect and switching selection modes.
A real Anthropic/ElevenLabs smoke test on November 17, 2026 identified the blue
vase and golden cube in earlier frames after the view turned away. This proves
one end-to-end path, not comparative accuracy or long-term recall quality.
