# Live sessions

`LiveLang` connects to native speech-to-speech models. Applications own media
capture, playback, storage, and reconnect policy. For separate transcription
and synthesis providers see [speech](speech.md).

## Connect

```ts
import { LiveLang } from "aiwrapper";

const live = LiveLang.openai({ apiKey: process.env.OPENAI_API_KEY! });
const session = await live.connect({
  instructions: "Keep spoken answers brief.",
  onEvent(event) {
    if (event.type === "output-audio") speaker.enqueue(event.frame);
    if (event.type === "input-transcript") console.log("user", event.transcript);
    if (event.type === "output-transcript") console.log("assistant", event.transcript);
    if (event.type === "response-interrupted") speaker.clear();
    if (event.type === "error") console.error(event.error);
  },
});
await session.appendAudio(microphoneFrame);
await session.close();
```

`microphoneFrame` and `speaker` belong to your application. Match the provider's
`inputFormat` and play its `outputFormat`; the shared [PCM contract](speech.md#pcm-contract)
does not resample audio.

| Factory | Credentials/options | Input → output |
| --- | --- | --- |
| `LiveLang.openai()` | `apiKey`, optional `model`, `voice` | 24 → 24 kHz |
| `LiveLang.google()` | `apiKey`, optional `model`, `voice`, `config` | 16 → 24 kHz |
| `LiveLang.xai()` | `apiKey`, optional `model`, `voice` | 24 → 24 kHz |
| `LiveLang.azure()` | `endpoint`, `apiKey` or `accessToken`, model/voice settings | 24 → 24 kHz |
| `LiveLang.aws()` | AWS credential chain, optional `region`, `model`, `voice` | 16 → 24 kHz |

Nova uses the optional `@aws-sdk/client-bedrock-runtime` package and a
bidirectional stream. Other providers use WebSockets; the default transport is
Node's `ws`, with `createWebSocket` available for alternative transports.
`LiveLang.mock()` supplies deterministic frames, transcripts, tools, and events.
The older `SpeechToSpeech` API exposes adapters through `createSession()`.

## Events and lifetime

Subscribe during connection with `onEvent`, or use
`session.addEventListener("event", listener)` for all events and specific names
such as `"output-audio"` for typed events. Remove subscriptions with
`removeEventListener`. Observer failures are isolated.

Events cover transcripts, audio, response start/end, interruption, tools, and
errors. Final transcripts may revise an existing `id`; replace that entry in
the UI. An empty final transcript still completes its input item. OpenAI's
`input-transcript-failed` event completes a failed transcription without closing
the voice connection. `observeLiveLangTimeline(session, callback)` derives turn milestones
and elapsed times and returns an unsubscribe function.

Pass `signal` to `connect()` for cancellation. `close()` is idempotent, stops
event delivery, and aborts tool handlers. Slow handlers do not block incoming
events. Cancelling work cannot undo completed tool side effects.

## Gemini controls

The playground and live tests pin `gemini-3.8-live`; library constructor defaults
can differ. Pin the model explicitly when configuring an application.

```ts
const live = LiveLang.google({
  apiKey: process.env.GOOGLE_API_KEY!,
  model: "gemini-3.8-live",
  voice: "Kore",
  connectTimeoutMs: 10_000,
  config: {
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    contextWindowCompression: { slidingWindow: {} },
    mediaResolution: "MEDIA_RESOLUTION_LOW",
    toolBehavior: "BLOCKING",
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
        endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
        prefixPaddingMs: 300,
        silenceDurationMs: 500,
      },
    },
  },
});
```

`resumeHandle` is application-owned. These voice-detection settings match the
playground and voice smoke test; tune them for your audio environment. Automatic
activity detection is required; manual activity markers are not exposed.
`connect()` waits for setup acknowledgement. Its timeout bounds socket creation
and setup, and closes sockets arriving after timeout or cancellation.

Gemini and OpenAI Realtime support text, images, and manual tool results. Check
optional methods before selecting another provider:

| Method | Meaning |
| --- | --- |
| `sendText(text)` | Add a user message and request a response |
| `sendText(text, { turnComplete: false })` | Append context without requesting a response |
| `sendText(text, { role: "assistant", turnComplete: false })` | Restore assistant context |
| `sendText(text, { realtime: true })` | Send user activity; cannot combine with assistant role or `turnComplete` |
| `appendImage({ data, mimeType })` | Send base64 JPEG/PNG bytes as video input |
| `endAudio()` | Gemini: end microphone input; later audio resumes the same connection |
| `interrupt()` | OpenAI: cancel generation without requesting another response |
| `truncateAudio({ itemId, contentIndex, playedMs })` | OpenAI: trim an audio part to its cumulative playback position |
| `sendToolResults(results)` | Submit results in manual tool mode |

Completed client content can interrupt generation; use incomplete content for
background context. Realtime text counts as user activity. See Google's
[Live API guide](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
for model-specific behavior.

## Tool ownership

By default, sessions execute [local tool handlers](agent.md#local-tools), emit
`tool-result`, and continue the model. Gemini additionally aborts individual
handlers on provider cancellation and suppresses their late results.

For application-owned execution, Gemini and OpenAI accept declarations without handlers:

```ts
const session = await live.connect({
  toolHandling: "manual",
  tools: [{
    name: "lookup",
    description: "Look up an item",
    parameters: { type: "object", properties: {} },
  }],
  onEvent: handleEvent,
});
// In the application's tool queue, after checking cancellation:
await session.sendToolResults!([{ callId, name: "lookup", result: { found: true } }]);
```

A result can carry pictures the model should see as part of it (a map, a photo):
`images: [{ data, mimeType }]`, base64 JPEG or PNG. Gemini Live puts them inside the
function response, where the model reads them as that result's own; a frame on the
video input reads as the camera and is often missed. OpenAI-compatible providers,
whose function output is text only, follow the output with an image message.

Manual mode emits `tool-call` without executing it; replayed calls are delivered
again. The host owns ordering, authorization, result caching, and cancellation
across connections. The remaining live providers reject manual mode before connecting.

`tool-calls-canceled` carries `callIds`, which Gemini filters from subsequent
submissions on that connection. The host must still check cancellation before
executing tools or submitting on a replacement connection. Resumed sessions can
accept results from earlier connections without receiving another call.

Automatic Gemini results use `{ result: value }`. Manual result objects are
preserved; primitives and arrays are wrapped in `{ result: value }`. Manual
submission emits no `tool-result`, so the host keeps its own execution timeline.
Image content parts are not supported in live tool results. A host can serialize
`appendImage()` before its JSON result, but those are separate, non-atomic messages.

OpenAI inserts silent text/images as conversation items. Completed text requests
a response, cancelling active generation first. Manual results must match calls
from the current connection; the adapter waits for the tool-producing response
to finish and for all its results before continuing. It emits `input-speech-start`
on VAD speech start so hosts can clear audio still queued for playback. Stop
local playback as well as calling `interrupt()`; generated audio is not a playback
cursor. OpenAI audio events include `playback: { itemId, contentIndex }`. Track
cumulative played milliseconds for each part across chunks. On Stop, cancel
generation, clear the playback queue, and call `truncateAudio` on the **same
session that emitted that audio**, even if generation has already finished:

```ts
await session.interrupt!();
// Application-owned: stop playback and return the discarded parts' positions.
for (const position of speaker.clearAndGetPlaybackPositions()) {
  await session.truncateAudio!(position); // { itemId, contentIndex, playedMs }
}
```

On `input-speech-start` or `response-interrupted`, clear and truncate without
requesting another response. Deduplicate repeated interruption events. Use zero
for queued audio that never played; never count silence padding or buffered
samples as played. The adapter rounds milliseconds down and rejects invalid
positions, but the application must keep them within the audio's actual duration.
Truncation removes unheard audio from provider context; it does not return an
aligned, shortened transcript. Other providers do not expose this capability.
See [OpenAI's interruption guidance](https://developers.openai.com/api/docs/guides/realtime-conversations#interruption-and-truncation).

OpenAI does not expose Gemini's resumption or compression controls.

## Gemini connection events

| Event | Meaning |
| --- | --- |
| `session-resumption` | Save `handle` when `resumable` is true; invalidate it on false |
| `connection-expiring` | Plan replacement; `timeLeftMs` may contain the deadline |
| `connection-closed` | Provider close details: `code`, `reason`, `wasClean` |
| `response-interrupted` | Clear playback, including for tool-only turns |
| `response-end` | Finish turn bookkeeping, including turns with no media |
| `provider-state` | Sparse diagnostic observations: `waitingForInput` and `inputActivity` (start/end) |

Provider observations do not start or interrupt a response. Missing fields mean
no observation, not false; hosts can log state changes without logging media.

Remote close also emits `error`; avoid starting two reconnect attempts.
Gemini `output-transcript` events with `source: "text"` are generated text,
not spoken-audio transcription. These controls do not provide automatic
rotation, persistent handles, or lossless media replay. See Google's
[session management guide](https://ai.google.dev/gemini-api/docs/live-api/session-management).
