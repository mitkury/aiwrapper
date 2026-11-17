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
example binaries. Chat at `/` also uses Rust; `/realtime` remains the older
TypeScript pipeline and is separate from this test path.

When the default language, Deepgram, and ElevenLabs keys are configured, the page
starts with real speech and Microphone selected. Capture begins only on Connect.
Otherwise it starts in **Offline test** mode. Connect and send
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

“Configured” means a value is present, not that the provider has validated it.
Provider authentication/model errors appear in the page. There is no automatic
provider fallback. Errors are also retained in the session event list after
disconnect; select `error` to inspect the message alongside preceding events.
HTTP failures can include provider status and response text; some connection
failures use summarized diagnostics.
Edit model IDs to test models available to your account.
Changing `.env` restarts the development server; reconnect afterward.

**Stop reply** clears local playback and cancels current inference/synthesis.
**Mute mic** disables the capture track and asks Flux to finish the active turn.
**Finish speaking** requests a provider turn boundary. **Disconnect** stops
capture, playback, and the native process. Camera input is opt-in: a JPEG up to
640 pixels wide is sampled once per second; only the latest frame at turn commit
is attached. Select a vision-capable language model for camera testing.

The microphone meter shows captured input level, independently of transcription.
Its status distinguishes muted/unavailable input, paused or stalled capture, and
audio waiting to send. “Audio sent” means the development host accepted browser
audio; it is not proof that the transcription provider recognized speech.
Capture status changes are retained as `microphone-status` events. A disconnected
microphone ends the session with an explicit error.

The event list retains up to 300 events / 8 MiB after disconnect. Select `request`
to inspect the neutral conversation and tools passed to the language provider,
`history` to see a playback correction, `tts-input` for each exact text segment
submitted to synthesis, or tool events to inspect results. `microphone-settings`
shows browser-reported echo cancellation and noise suppression settings. The
browser is asked to enable both at capture; effectiveness against speaker
playback still depends on the browser/device and is not measured by this event. This
is an initial diagnostic list, not the planned recording/timeline inspector.
It does not show the provider's final wire payload or record microphone audio.

## Runtime boundaries

`live::CascadeConfig::new(language, speech)` returns the usual `LiveSession` via
`connect()`. Supply an optional `speech_stream::TranscriptionSession`, initial
conversation, tools and parent cancellation token. Keep polling the receiver.
`SpeechInput` accepts PCM and provider turn-end requests; `SpeechOutput` streams
PCM for one text segment. Hosts can inject deterministic providers through these
contracts. `DeepgramFlux` supplies the initial persistent STT adapter;
`HttpSpeechOutput` wraps the existing speech clients. `MockSpeechOutput` emits a
tone for offline tests.

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

Audio events identify a response and segment. The browser reports cumulative
played milliseconds for each segment through `truncate_audio`. On interruption,
only fully played segments survive in the next request; partial words are not
estimated. An acknowledgement received after a cut never grows the message.
The receiver discards queued audio from retired response generations. Playback
is conservative if acknowledgements arrive late. Hosts must supply cursors to
retain heard text; absence of acknowledgement means the segment is unconfirmed.

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
