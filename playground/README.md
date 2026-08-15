# AIWrapper playground

This is one browser app for manually testing AIWrapper. Launch it once and use
the top navigation to switch between test suites:

- **Playground** exercises `ChatAgent`, language providers, tools, and message inspection.
- **Voice** records microphone PCM, transcribes it with OpenAI, and speaks the
  editable transcript with OpenAI or ElevenLabs.
- **Realtime** runs a continuous streaming STT -> selected LLM -> streaming TTS
  cascade with barge-in interruption and optional camera context.
- **Live voice** streams microphone audio directly through OpenAI Realtime or
  Gemini Live using the same speech-to-speech interface.

## Providers

Open **Providers & Keys** to switch between OpenAI, Anthropic, Google Gemini,
Groq, DeepSeek, Kimi, xAI, Cohere, Mistral, OpenRouter, Ollama, and custom
OpenAI-compatible APIs.

Every provider has an independent saved API key and model, and Ollama and
OpenAI-compatible providers also have independent base URLs. The settings are
stored in this browser's local storage under the `secrets` key, so changing
providers does not discard the previous provider's credentials.

The model selector is populated from the locally linked `aimodels` package and
contains every catalog model that supports chat through the selected provider.
The app stores canonical catalog IDs and translates them to provider-specific
IDs when needed. For example, selecting canonical model `gpt-5.6-sol` for
OpenRouter sends `openai/gpt-5.6-sol` to its API.

The regular Playground calls language providers directly from the browser. Use
restricted development keys there, not privileged production credentials, and
be aware that a provider must allow browser requests through CORS. Realtime is
different: its complete STT -> LLM -> TTS pipeline runs on the playground
server and uses server environment variables.

## Speech environment

The voice playground sends microphone audio to same-origin SvelteKit endpoints,
so speech-provider keys remain on the development server. Put these values in
the repository root `.env` file:

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
GROQ_API_KEY=
DEEPSEEK_API_KEY=
KIMI_API_KEY=
XAI_API_KEY=
COHERE_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

OpenAI enables realtime transcription and OpenAI speech. `DEEPGRAM_API_KEY`
enables Deepgram Flux realtime transcription. `ELEVENLABS_API_KEY` enables
ElevenLabs Scribe realtime transcription and TTS, and lets the server load the account's
available voices without exposing the key to the browser.
`ELEVENLABS_VOICE_ID` selects its initial voice and also enables ElevenLabs in
the standalone Voice playground. `OPENAI_REALTIME_TRANSCRIPTION_MODEL` optionally
sets the realtime transcription model, and
`OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE` can pin an ISO-639-1 language such as
`en` to reduce false language detection. Restart the playground after changing
`.env`.

Optional realtime STT defaults are `DEEPGRAM_FLUX_MODEL` (normally
`flux-general-en` or `flux-general-multi`) and `ELEVENLABS_STT_MODEL` (normally
`scribe_v2_realtime`). `DEEPGRAM_FLUX_EOT_TIMEOUT_MS` and
`ELEVENLABS_STT_VAD_SILENCE_SECONDS` tune the maximum/silence endpoint delays.
The realtime playground defaults ElevenLabs TTS to the low-latency
`eleven_flash_v2_5`; set `ELEVENLABS_TTS_MODEL` to override it.

The Live voice page uses `OPENAI_API_KEY` for OpenAI Realtime and
`GOOGLE_API_KEY` for Gemini Live. Optional defaults are
`OPENAI_SPEECH_TO_SPEECH_MODEL`, `OPENAI_SPEECH_TO_SPEECH_VOICE`,
`GEMINI_LIVE_MODEL`, and `GEMINI_LIVE_VOICE`. Provider and model controls are
disabled during an active session because live conversation state cannot be
transferred losslessly between providers.

Realtime exposes STT, LLM, and TTS as three independent pipeline controls. A
server-owned session creates the selected providers and one `RealtimeAgent`, so
credentials, VAD/turn detection, the conversation, tool execution, LLM
streaming, text segmentation, TTS, interruption, and latency measurement all
stay on the server. The browser only captures media, sends text and the latest
camera frame, plays PCM, and renders events.

Each provider is enabled when its corresponding server variable is present.
Ollama uses `OLLAMA_BASE_URL` or the legacy `OLLAMA_URL` (default
`http://localhost:11434`). An
OpenAI-compatible provider uses `OPENAI_COMPATIBLE_BASE_URL` and the optional
`OPENAI_COMPATIBLE_API_KEY`.

The browser receives JSON events and raw PCM over one framed streaming response.
On an HTTPS origin with HTTP/2 or HTTP/3, it sends 24 kHz PCM through one
long-lived framed upload. The plain HTTP/1.1 development server uses ordered
same-origin PCM posts because browsers reject streaming request bodies over
HTTP/1.x. The protocol is a playground transport adapter; the reusable
`RealtimeAgent` remains transport independent and can later sit behind WebRTC or
another media transport. The realtime page requests low reasoning effort from
OpenAI and lowest-latency provider routing from OpenRouter without changing the
regular chat page. Camera context starts off because vision adds model latency;
enable it when a turn actually needs an image.

## Development

```bash
npm ci
npm ci --prefix playground
npm --prefix playground run dev
```

Then open the single URL printed by Vite. The general playground is at `/`,
voice is at `/speech`, and the cascade experiment is at `/realtime`; all use
that same process. Native live models are at `/speech-to-speech`.

Validate the app with:

```bash
npm run check:playground
```
