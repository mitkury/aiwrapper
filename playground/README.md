# AIWrapper playground

This is one browser app for manually testing AIWrapper. Launch it once and use
the top navigation to switch between test suites:

- **Playground** exercises `ChatAgent`, language providers, tools, and message inspection.
- **Voice** records microphone PCM, transcribes it with OpenAI, and speaks the
  editable transcript with OpenAI or ElevenLabs.
- **Realtime** runs a continuous streaming STT -> selected LLM -> streaming TTS
  cascade with barge-in interruption and optional camera context.
- **Live voice** streams microphone audio directly through OpenAI Realtime,
  Gemini Live, xAI Voice, Azure Voice Live, or Amazon Nova 2 Sonic using the
  same speech-to-speech interface.

## Providers

Open **Providers & Models** to switch between OpenAI, Anthropic, Google Gemini,
Groq, DeepSeek, Kimi, xAI, Cohere, Mistral, OpenRouter, Ollama, and custom
OpenAI-compatible APIs.

Every page reads provider credentials from the repository root `.env`. Chat and
Realtime use the same server-side language-provider configuration; Voice and
Live voice use the same provider keys. See [`.env.example`](../.env.example) for
the supported keys and optional defaults. No API keys are sent to the browser.

Provider and model selections are stored in this browser's local storage under
`provider-settings`. Existing provider/model preferences are migrated from the
old `secrets` entry, and its browser-stored credentials are removed. Base URLs
come from `.env`, including `OLLAMA_URL` and `OPENAI_COMPATIBLE_BASE_URL`.

The model selector is populated from the compiled `aimodels/` submodule and
contains every catalog model that supports chat through the selected provider.
The app stores canonical catalog IDs and translates them to provider-specific
IDs when needed. For example, selecting canonical model `gpt-5.6-sol` for
OpenRouter sends `openai/gpt-5.6-sol` to its API.

The dev command builds the catalog before starting Vite. After editing catalog
data, run `npm run aimodels:build` from the repository root to refresh it. See
[working with AIModels](../docs/dev/aimodels.md) for the submodule workflow.

Chat runs `ChatAgent` on the playground server and streams messages to the
browser. Streaming, built-in tools, Stop, retry, message inspection, and local
conversation history remain available. Realtime runs its complete STT -> LLM ->
TTS pipeline on that same server.

## Model defaults

Chat and Realtime share the defaults in
[`src/lib/provider-config.ts`](src/lib/provider-config.ts). Selection precedence is:

1. A model explicitly selected in this browser.
2. The provider's `.env` override, such as `OPENAI_MODEL` or `GOOGLE_MODEL`.
3. The playground's `defaultModel` below.

Use **Use default** in Providers & Models (then Save), or **Use default model**
in Realtime, to clear a saved model override. This follows subsequent `.env` or
code default changes too. Existing explicit choices are preserved.

Defaults reviewed September 2026:

| Provider | Default | Reference |
| --- | --- | --- |
| OpenAI | `gpt-5.6-sol` | [Model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| Anthropic | `claude-sonnet-5` | [Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5) |
| Google | `gemini-3.8-flash` | [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) |
| Groq | `gpt-oss-120b` | [Production models](https://console.groq.com/docs/models); the adapter sends `openai/gpt-oss-120b` |
| DeepSeek | `deepseek-flash` | [Current API model alias](https://api-docs.deepseek.com/) |
| Kimi | `kimi-k3` | [Kimi K3](https://forum.moonshot.ai/t/kimi-k3-is-here-our-most-capable-model/480) |
| xAI | `grok-4.6` | [Grok 4.6](https://docs.x.ai/developers/grok-4-6) |
| Cohere | `command-a-plus-05-2026` | [Command A+](https://docs.cohere.com/docs/command-a-plus) |
| Mistral | `mistral-medium-3-5` | [Mistral Medium 3.5](https://docs.mistral.ai/models/mistral-medium-3-5-26-04) |
| OpenRouter | `gpt-5.6-sol` | Catalog maps this to `openai/gpt-5.6-sol` |
| Ollama | `qwen3.5:4b` | [Local model](https://ollama.com/library/qwen3.5:4b); install it with `ollama pull qwen3.5:4b` |

Custom OpenAI-compatible endpoints require their own model ID. Official API
aliases can be used even before the local catalog includes them; they appear
as custom entries in the selector.

Speech defaults are controlled in
[`api/speech/config/+server.ts`](src/routes/api/speech/config/+server.ts) and
[`server/realtime-speech.ts`](src/lib/server/realtime-speech.ts). Native Live voice
defaults are in
[`server/speech-to-speech-sessions.ts`](src/lib/server/speech-to-speech-sessions.ts).
Their `.env` override names are documented below. These playground settings do
not change the library constructor defaults in the repository's `src/` directory.

## Speech environment

The voice playground sends microphone audio to same-origin SvelteKit endpoints,
so speech-provider keys remain on the development server. Put these values in
the repository root `.env` file:

Start with the [root environment template](../.env.example); fill in the keys
for the providers you want to use. Existing `.env` files do not need to be replaced.

OpenAI enables realtime transcription and OpenAI speech. `DEEPGRAM_API_KEY`
enables Deepgram Flux realtime transcription. `ELEVENLABS_API_KEY` enables
ElevenLabs Scribe realtime transcription and TTS, and lets the server load the account's
available voices without exposing the key to the browser.
`ELEVENLABS_VOICE_ID` selects its initial voice. Without it, enter a voice ID
in Voice or select an account voice in Realtime. `OPENAI_REALTIME_TRANSCRIPTION_MODEL` optionally
sets the realtime transcription model, and
`OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE` can pin an ISO-639-1 language such as
`en` to reduce false language detection. In development, changing `.env`
automatically restarts the playground server.

Optional realtime STT defaults are `DEEPGRAM_FLUX_MODEL` (normally
`flux-general-en` or `flux-general-multi`) and `ELEVENLABS_STT_MODEL` (normally
`scribe_v2_realtime`). `DEEPGRAM_FLUX_EOT_TIMEOUT_MS` and
`ELEVENLABS_STT_VAD_SILENCE_SECONDS` tune the maximum/silence endpoint delays.
Voice and Realtime default ElevenLabs TTS to the low-latency
`eleven_flash_v2_5`; set `ELEVENLABS_TTS_MODEL` to override it.

The Live voice page uses `OPENAI_API_KEY` for OpenAI Realtime,
`GOOGLE_API_KEY` for Gemini Live, `XAI_API_KEY` for xAI Voice,
`AZURE_VOICE_LIVE_ENDPOINT` plus either `AZURE_VOICE_LIVE_API_KEY` or
`AZURE_VOICE_LIVE_ACCESS_TOKEN` for Azure, and the standard AWS SDK credential
chain for Nova. Export `AWS_PROFILE` in your shell when using a named AWS profile;
it is not loaded from the playground `.env` by the AWS SDK. Optional defaults are `OPENAI_SPEECH_TO_SPEECH_MODEL`,
`OPENAI_SPEECH_TO_SPEECH_VOICE`, `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_VOICE`,
`XAI_SPEECH_TO_SPEECH_MODEL`, `XAI_SPEECH_TO_SPEECH_VOICE`,
`AZURE_VOICE_LIVE_MODEL`, `AZURE_VOICE_LIVE_VOICE`,
`AZURE_VOICE_LIVE_VOICE_TYPE`, `AMAZON_NOVA_SONIC_MODEL`, and
`AMAZON_NOVA_SONIC_VOICE`. Nova defaults to `AWS_REGION` or
`AWS_DEFAULT_REGION`, then `us-east-1`; set `AMAZON_NOVA_SONIC_ENABLED=false`
to hide it from the page. Provider and model controls are
disabled during an active session because live conversation state cannot be
transferred losslessly between providers.

The page derives a provider-neutral turn timeline from the shared
speech-to-speech events. It reports connection setup, first/final input
transcript, response start, first response text, first playable audio,
completion, interruption, and errors using server arrival times. This is
diagnostic timing rather than provider billing or token telemetry.

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
