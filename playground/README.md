# AIWrapper playground

The playground runs AI inference, speech providers, live sessions, and tools in
Rust. TypeScript supplies browser UI/media, preferences, and a development bridge
that launches native processes. There is no TypeScript inference fallback.
The existing TypeScript library remains in the repository for now.

## Run

Install Node.js 20+ and Rust, then from the repository root:

```sh
npm ci
npm ci --prefix playground
npm run sandbox:native
```

`npm --prefix playground run dev` uses the same Rust backend. Its `predev` step
builds the native examples. Put credentials in the root `.env`; they remain on
the server. Open the URL printed by Vite. Editing source or `.env` may reload the
development app; reconnect sessions after a rebuild.

| Page | Route | Rust capability |
| --- | --- | --- |
| Chat | `/` | Language providers, ChatAgent, local tools, message inspection |
| Voice | `/speech` | Recorded OpenAI transcription; OpenAI or ElevenLabs synthesis |
| Cascade | `/cascade` | Deepgram Flux → selected language provider → OpenAI/ElevenLabs speech |
| Simulator | `/simulator` | Walkable 3D room → Rust frame selection → Cascade |
| Live voice | `/speech-to-speech` | OpenAI Realtime or Gemini Live through LiveSession/LiveAgent |

`/realtime` redirects to Cascade. The duplicate TypeScript pipeline and its API
routes are removed. xAI Voice, Azure Voice Live, Nova Sonic, and OpenAI/ElevenLabs
realtime transcription are not exposed here until native adapters support them.
The Voice page accepts a voice ID; the old account voice-list endpoint is removed.

The [visual simulator guide](../docs/native-vision.md) covers room controls,
latest-only versus recent frame history, exact request-frame previews, and limits.
The simulator starts with the microphone on and session settings collapsed.
**Start session** requests microphone access and begins sampling. The top bar
shows microphone state, input level and playback status. Conversation stays beside
the room on desktop; settings, frame inspection and events expand below. Offline
mode visibly disables the microphone and tests plumbing without recognizing objects.

## Configuration

Chat model precedence is browser selection, server `.env`, then the playground
default. Chat preferences live in browser storage; model catalog data is used
only for display/selection. Rust translates provider requests. See
[provider-config.ts](src/lib/provider-config.ts) for display defaults.

Chat and Cascade share Rust host provider configuration. Both accept keyless
OpenAI-compatible endpoints and Ollama. `OLLAMA_BASE_URL` takes precedence over
the `OLLAMA_URL` alias.

- Chat: the selected provider's API key; Ollama and a configured compatible
  endpoint can operate without a key.
- Voice: `OPENAI_API_KEY` for recorded transcription and OpenAI output;
  `ELEVENLABS_API_KEY` and a voice ID for ElevenLabs output.
- Cascade: `DEEPGRAM_API_KEY`, a language provider key, and a speech-output key.
  Its explicit offline mode uses typed input, mock replies, real local tools,
  and a short playback tone.
- Live voice: `OPENAI_API_KEY` or `GOOGLE_API_KEY`. The respective model/voice
  overrides are `OPENAI_SPEECH_TO_SPEECH_MODEL` / `OPENAI_SPEECH_TO_SPEECH_VOICE`
  and `GEMINI_LIVE_MODEL` / `GEMINI_LIVE_VOICE`.

The live page resamples input to the Rust session's rate: 24 kHz for OpenAI,
16 kHz for Gemini. Gemini supports the optional camera. Speak to interrupt
Gemini; its Stop playback button only silences browser output. OpenAI supports
server cancellation and truncation at the browser's played cursor.

`AIWRAPPER_NATIVE_MOCK=1` enables offline Chat. Send
`tool: add {"a":2,"b":3}` to exercise Rust tools. This flag does not mock Voice
or native live providers. `AIWRAPPER_RUNTIME` is no longer used.

## Transport and diagnostics

Rust examples communicate through stdin/stdout. Chat and recorded-speech requests
use one process per request; Cascade and Live voice use a persistent process per
session. HTTP routes validate input and relay results; they do not call providers.
This is a development bridge, not a production hosting service or WebRTC server.

Cascade and Live voice share capture, playback, microphone health indicators,
and a retained event list. Select `error` for provider/runtime errors. See the
[cascade guide](../docs/native-cascade.md) for playback and diagnostic limits.
Cancelling a request or disconnecting terminates its native process.

Trusted host settings can override example binaries with
`AIWRAPPER_NATIVE_BINARY`, `AIWRAPPER_SPEECH_BINARY`, and
`AIWRAPPER_CASCADE_BINARY`. `AIWRAPPER_LIVE_ENDPOINT` is a host-only WebSocket
endpoint override for protocol fixtures; leave it unset for normal provider use.

## Validate

```sh
npm run native:check
npm run native:test:sandbox
npm run native:test:cascade
npm run native:test:media
npm run check:playground
```

Media smoke tests run real native processes against local HTTP/WebSocket fixtures.
They cover transcription, both synthesis providers, both live protocols, tool
execution, PCM, and provider errors without credentials or remote calls.

Cascade and Simulator mark interrupted replies at the Rust runtime's retained
text boundary. Expand the generated remainder to compare it with the model's
next request. ElevenLabs supplies speech timing; providers without alignment
show an explicitly approximate boundary. See [playback handling](../docs/native-cascade.md#runtime-boundaries).
