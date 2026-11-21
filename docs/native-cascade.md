# Rust cascade playground

The first cascade runs Deepgram Flux transcription, a Rust `LanguageProvider`,
and OpenAI or ElevenLabs HTTP streaming synthesis. Speech starts from bounded
text segments while the language model continues. `LiveAgent` is the only tool
executor. TypeScript handles browser media and the development process bridge.

## Run locally

From the repository root, with Node.js 20+ and Rust installed:

```sh
npm ci
npm ci --prefix playground
cp .env.example .env # only if .env does not already exist
npm run sandbox:native -- --host 127.0.0.1
```

Open `/cascade` at the URL printed by Vite. The launch command builds both native
example binaries. All playground AI operations use Rust. `/realtime` redirects
to this page; the duplicate TypeScript pipeline has been removed. Native
OpenAI/Gemini audio models are available at `/speech-to-speech`.

When the default language, Deepgram, and ElevenLabs keys are configured, the page
starts with real speech and Microphone selected. Capture begins only on **Start session**.
Otherwise it starts in **Offline test** mode. Start a session and send
`tool: add {"a":2,"b":3}` to exercise real local tool execution and PCM playback.
Offline output is a tone, not synthesized speech. No microphone transcription or
provider requests occur in offline mode.

For real speech, disable Offline test, choose providers, and enable Microphone
before connecting. With Microphone disabled, typed input needs only language
and synthesis providers; no transcription connection is opened. Keys stay in the root `.env` on the server:

| Component | Required configuration |
| --- | --- |
| Transcription | `DEEPGRAM_API_KEY`; select English or multilingual Flux |
| Language | The selected provider's key, such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY` |
| ElevenLabs output | `ELEVENLABS_API_KEY`; a voice ID in the page or `ELEVENLABS_VOICE_ID` |
| OpenAI output | `OPENAI_API_KEY`; model and voice in the page |

Cascade and the Voice page both honor `OPENAI_BASE_URL` and `ELEVENLABS_BASE_URL`
for speech requests.

“Configured” means a value is present, not that the provider has validated it.
Provider authentication/model errors appear in the page. There is no automatic
provider fallback. Errors are also retained in the session event list after
disconnect; select `error` to inspect the message alongside preceding events.
HTTP failures can include provider status and response text; some connection
failures use summarized diagnostics.
Edit model IDs to test models available to your account.
Changing `.env` restarts the development server; reconnect afterward.

The playground's Cascade, Simulator and Live voice instructions request plain
text meant to be spoken aloud: natural sentences without Markdown, headings,
lists, tables, code blocks or emphasis markers. Edit **System instructions** in
**Session settings** to replace those instructions. Edits update page state
immediately, with no Save button, cookies or browser storage. They are used by
the next session; an active session keeps the instructions it started with.
Reloading the page restores defaults. An empty field sends empty instructions.
The Rust host and editor share defaults from `native/examples/voice-instructions.json`.

**Stop reply** clears playback and cancels current inference, synthesis, and any reply
waiting for a playback acknowledgement or tool result. The next turn can still use
the earlier input and completed tool results.
The microphone button mutes or unmutes capture. Muting also asks Flux to finish the active turn.
**Finish speaking manually** in Session events requests a provider turn boundary. **End session** stops
capture, playback, and the native process. Camera input is opt-in: a JPEG up to
640 pixels wide is sampled once per second. Choose latest-frame-only or bounded
recent history (up to 12 frames per turn). The library defaults to latest-only;
the playground defaults to recent history. Select a vision-capable language model.
See [camera context and the 3D simulator](native-vision.md) for selection, retention
and exact request-frame inspection.

The microphone meter shows captured input level, independently of transcription.
Its status distinguishes muted/unavailable input, paused or stalled capture, and
audio waiting to send. “Audio sent” means the development host accepted browser
audio; it is not proof that the transcription provider recognized speech.
Capture status changes are retained as `microphone-status` events. A disconnected
microphone ends the session with an explicit error.

The event list retains up to 300 events / 8 MiB after disconnect. Image bytes
are shortened in every event preview; individual previews are capped at 64 Ki
characters. Full retained requests remain available in the request inspector.
Select `request` to inspect the neutral conversation and tools passed to the
language provider,
`playback-cut` to inspect an interruption, `history` to see the corrected context, `tts-input` for each exact text segment
submitted to synthesis, or tool events to inspect results. `microphone-settings`
shows browser-reported echo cancellation and noise suppression settings. The
browser is asked to enable both at capture; effectiveness against speaker
playback still depends on the browser/device and is not measured by this event.
The event list does not show the provider's final wire payload or record microphone audio.

### Choosing silence

The Rust playground host exposes `keep_silent` in Cascade, Simulator, and Live
voice. Default instructions ask the model to call it alone, without spoken text,
when the current input needs no reply (such as a filler, background remark, or a
request to wait). It uses the existing silent-tool behavior: record the result
without starting a follow-up response, and keep listening. The call and result
remain visible in session events and request history. The model decides when to
use it; silence does not undo audio already generated before the tool call.

### Turn timeline

On Cascade and Simulator, expand **Turn timeline** under **Configure & inspect**.
Select a turn (or follow the latest) to see activities on one shared time axis:
user input, waiting for the first AI text, AI text generation, voice generation,
and the entire voice playback span. Vertically aligned bars happened concurrently.
For example, a one-second AI response can overlap with a five-second spoken reply.
Bars grow while active, then freeze at completion or interruption. A dashed marker
shows interruption, session end, or error; already completed activities keep their
original end times. Select a lane for its start/end times and explanation.

Voice generation spans the first speech request through completion of all phrases,
including waits between phrases. Voice playback runs from first playback through
the last played audio, including streaming gaps. No playback bar is shown if no
audio started. These are activity spans, not measurements of provider CPU time.
The chart updates only while its Timing view is open and the selected activity is
unfinished. **First-audio latency breakdown** retains the detailed stage waits.
The main wait metric runs from the final transcript to first playback, or
from Send to first playback for typed input. Input duration includes the user's
speech and provider turn detection; it is not an isolated transcription benchmark.
Tool continuations appear as additional model requests within the same turn.

Switch to **Sent to model** to inspect the selected request's system instructions,
full conversation in message order, exact image attachments, tool calls/results,
available tool definitions, and output token limit. **Inspect request** beneath a
user message opens this view directly. Images appear in their original message,
with capture times for selected camera frames; click to enlarge. Snapshots preserve
the input at request time, including interruption-adjusted history. Later edits to
the prompt or conversation do not rewrite earlier requests. This is the neutral
input passed to the Rust language provider, not the provider-specific HTTP body.
The expandable request structure omits image bytes to keep JSON readable; image
previews use those exact retained bytes.

**Provider JSON** shows the body captured by `ChatOptions.on_request` immediately
before each HTTP transport attempt, after provider mapping and body overrides.
The capture excludes headers and credentials. A captured attempt does not prove
provider acceptance. Offline mocks have no provider HTTP body. The UI shows the
latest attempt for a request; Cascade currently disables retries.

Image byte strings are shortened by default, preserving the JSON keys and all
text. Enable **Include image bytes in preview** or **Download full JSON** for the
complete body. This is also where to inspect timestamp placement: the runtime
inserts a text item such as `Camera frame 7 at 12.345s (capture clock,
session-relative).` immediately before each image. Adapters map these ordered
text/image items to the provider's content format. Camera selection metadata stays
in the neutral diagnostic payload, not the model's image caption.

**Event times** includes model/synthesis completion, playback drain and interruption
on the session clock. Provider milestones are measured when the browser receives
them, so they include transport. Playback start uses the browser audio render clock,
not PCM receipt; hardware output latency is not measured. Full streaming stages
overlap, and playback span can include gaps between audio chunks.

The embedded visual strip shows exact selected request images in capture order,
with frame IDs and capture timestamps. It has its own time labels so minutes of
visual history do not flatten response latency. Strip spacing is not a time scale.
Click to enlarge a frame. Evicted image previews are identified explicitly.

The viewer retains at most 80 turns with 12 model requests each, holds only timing
metadata and short transcript excerpts. Request snapshots share one 8-request /
16 MiB store for conversation text, tools, images, and provider bodies, counted
using a conservative serialized UTF-16 size. Eviction of a snapshot also evicts
its frame previews. Only the selected request's thumbnails render while the
timeline is open, with lazy image decoding. It keeps no PCM or separate image history. Ending
a session retains the timeline; starting another clears it. Native Live voice uses
a different provider protocol and does not expose this Cascade stage breakdown.

## Runtime boundaries

`live::CascadeConfig::new(language, speech)` returns the usual `LiveSession` via
`connect()`. Supply an optional `speech_stream::TranscriptionSession`, initial
conversation, tools and parent cancellation token. Keep polling the receiver.
`SpeechInput` accepts PCM and provider turn-end requests; `SpeechOutput` streams
PCM for one text segment. Hosts can inject deterministic providers through these
contracts. `DeepgramFlux` supplies the initial persistent STT adapter;
`HttpSpeechOutput` wraps the existing speech clients. `MockSpeechOutput` emits a
tone for offline tests.

For a request inspector, set `config.capture_requests = true` before calling
`connect()`. The playground host enables this option. It emits the normalized
model input (`request`), provider JSON (`provider-request`), conversation
snapshots (`history`), and speech synthesis text (`tts-input`). These may
contain tool results and camera images. Embedded sessions default to capture off
and still deliver audio, transcripts, tool calls, and playback acknowledgements.

Speech segmentation prefers sentence and clause boundaries. A 200 ms timer can
release a complete-word prefix of at least 40 characters; the 160-character
target also splits only at whitespace. Unfinished words wait for a boundary or
model completion. Each segment remains a separate HTTP synthesis request, so
prosody can still differ across segments. Incremental text-input synthesis with
shared context is follow-up work.

Wrap the session in `LiveAgent` for tools. When interrupted during a tool, its
actual result must resolve before a queued user turn starts. The cascade does
not invent a result or rerun the handler. Silent tools suppress a follow-up when
all calls in that round are silent. A spoken tool preamble must finish playback
before the follow-up model round; missing acknowledgement fails after 30 seconds.
Call IDs must be unique within the session.

Audio events identify a response and segment. Hosts report cumulative **played**
milliseconds for each segment through `truncate_audio`; queued audio does not
count. On interruption, stop playback immediately. Rust emits `Interrupted`
followed by a `ProviderState` with `kind: "playback-stop-requested"` and `itemId`.
Send the final cursors, then `LiveSender::playback_stopped(item_id)`, in order.
The next model request waits for that acknowledgement, or up to 500 ms (checked
on the 200 ms runtime tick). Hosts without this acknowledgement still work, but
use the last known cursor; the event reports `playbackConfirmed: false`.
Late acknowledgements after finalization cannot change a request already sent.

A `ProviderState` with `kind: "playback-cut"` contains a public `live::PlaybackCut`
under `cut`: response ID, played/generated milliseconds, retained text, generated
remainder, boundary accuracy and acknowledgement status. It is emitted only
when generated text was removed. Fully played replies are not marked interrupted.
The same retained text is used in model history and the playground transcript.
A playback-context note tells the model the user interrupted an earlier reply,
through detected speech (including microphone sounds detected as speech without
recognized words), a new typed message, or Stop reply. It describes normal
turn-taking rather than a technical failure, without assuming deliberate intent.
The model is asked to mention interruptions only when relevant. The discarded
continuation is not sent back to the model.

`SpeechOutput::synthesize_timed` optionally supplies `SpeechEvent::Timing` points
alongside audio. Points use UTF-8 byte offsets in the original segment text and
end times relative to that synthesis request. Existing implementations need no
changes: the default wraps their PCM stream. `HttpSpeechOutput` uses ElevenLabs'
[stream-with-timestamps endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps)
for original-text character alignment. Normalized-text offsets are not treated
as original-text offsets. The cutoff backs out of a partial word where possible.

Accuracy is `provider-timed` when alignment covers the cutoff, `estimated` when
a completed segment's text is apportioned by audio duration, or `segment-boundary`
when incomplete synthesis has no reliable finer boundary. Estimates are labelled;
they are not word-level measurements. Playback tracks browser scheduling, not
proof that sound reached the listener's ears.

In Cascade and Simulator, interrupted replies show an **Interrupted by user** marker with played time,
timing accuracy and an expandable **Generated remainder · excluded from model
history**. This stays available after End session. Native OpenAI/Gemini Live
voice retains its provider-specific interruption behavior; this cutoff viewer
currently covers the Rust cascade.

Playback edits update visible provider replay text while retaining opaque
reasoning and tool fields. Editing signed Gemini text fails explicitly. General
editing of arbitrary `Message.meta` outside this operation still needs the
follow-up described in the migration proposal.

The runtime bounds input commands, model updates, synthesis text and PCM queues.
Overflow fails the session visibly; it never silently drops microphone or speech
output. Text/model size, 12 model rounds per turn, 256 history messages, and an
8 MiB history cap prevent indefinite accumulation. Start a new session at those
limits. LLM and speech stalls have deadlines. Closing or dropping the receiver
cancels owned work without cancelling the caller's parent token.

Browser playback accepts speech generated ahead of listening, up to 120 seconds,
16 MiB of decoded samples, or 4,096 chunks. Reaching a playback limit stops the
session with an explicit error and requires reconnecting. It is not labeled as
a user interruption. Only audio actually played is acknowledged. Gemini Live stops local playback;
it does not support explicit generation cancellation through this adapter.

The example host uses one persistent Rust process per session over bounded
NDJSON. The playground bridge owns process startup, a maximum of eight sessions,
and a 30-minute lifetime. It is a local development host, not a production
hosting/authentication service. `AIWRAPPER_CASCADE_BINARY` can select an already
built native example binary.

## Validation and current limits

```sh
npm run native:check
npm run native:test:cascade
npm run native:test:sandbox
npm run check:playground
```

On November 17, 2026, credential-backed smoke checks exercised Anthropic
`claude-sonnet-5`, Groq `openai/gpt-oss-20b`, and OpenRouter
`anthropic/claude-sonnet-5`, each with Deepgram Flux and ElevenLabs
`eleven_flash_v2_5`. All produced tool results and PCM. An audio round trip fed
synthesized PCM into Flux, obtained the expected transcript, and generated a
spoken answer. This validates the media protocol, not physical microphone or
echo behavior on every device. Headless Chrome checks covered offline and real-provider connect, tool use,
synthetic microphone/camera capture, Stop, and disconnect.

A repeated-speech browser check also exercised four exchanges in one minute
with Deepgram, Anthropic, and ElevenLabs, including new speech before the first
model token. That exposed and verified a fix for empty assistant placeholders
being replayed after interruption. Capture pause/resume checks verified the
microphone status changes. Synthetic media cannot establish physical-device
reliability or identify an earlier session's cause without its trace.

Incremental text-input TTS, word alignment, context compression, nuanced
interruption detection, full session recording/inspection, and measured latency
comparison with native live models remain follow-up work. This version uses
immediate interruption on Flux speech start. It does not classify backchannels,
provide WebRTC, or implement automatic speech reconnect/replay.
