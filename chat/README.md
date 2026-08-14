# AIWrapper playground

This is one browser app for manually testing AIWrapper. Launch it once and use
the top navigation to switch between test suites:

- **Chat** exercises `ChatAgent`, language providers, tools, and message inspection.
- **Voice** records microphone PCM, transcribes it with OpenAI, and speaks the
  editable transcript with OpenAI or ElevenLabs.
- **Realtime** runs a continuous streaming STT -> selected LLM -> streaming TTS
  cascade with barge-in interruption and optional camera context.

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

This app calls providers directly from the browser. Use restricted development
keys, not privileged production credentials, and be aware that a provider must
allow browser requests through CORS.

## Speech environment

The voice playground sends microphone audio to same-origin SvelteKit endpoints,
so speech-provider keys remain on the development server. Put these values in
the repository root `.env` file:

```bash
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

OpenAI enables transcription and OpenAI speech. The two ElevenLabs values
enable ElevenLabs speech. `OPENAI_REALTIME_TRANSCRIPTION_MODEL` optionally
overrides the realtime transcription model, and
`OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE` can pin an ISO-639-1 language such as
`en` to reduce false language detection. Restart the playground after changing
`.env`.

Realtime uses the language provider selected under **Providers & Keys**. The
browser sends 24 kHz PCM to a same-origin endpoint, receives transcription
events over SSE, and streams raw PCM speech back. That transport is only the
playground adapter; the `RealtimeAgent` itself is transport independent. The
realtime page requests low reasoning effort from OpenAI and lowest-latency
provider routing from OpenRouter without changing the regular chat page.

## Development

```bash
npm ci
npm ci --prefix chat
npm --prefix chat run dev
```

Then open the single URL printed by Vite. Chat is at `/`, voice is at `/speech`,
and the cascade experiment is at `/realtime`; all use that same process.

Validate the app with:

```bash
npm run check:demo
```
