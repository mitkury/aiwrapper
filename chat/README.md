# AIWrapper playground

This is one browser app for manually testing AIWrapper. Launch it once and use
the top navigation to switch between test suites:

- **Chat** exercises `ChatAgent`, language providers, tools, and message inspection.
- **Voice** records microphone PCM, transcribes it with OpenAI, and speaks the
  editable transcript with OpenAI or ElevenLabs.

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

## Voice environment

The voice playground sends microphone audio to same-origin SvelteKit endpoints,
so speech-provider keys remain on the development server. Put these values in
the repository root `.env` file:

```bash
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

OpenAI enables transcription and OpenAI speech. The two ElevenLabs values
enable ElevenLabs speech. Restart the playground after changing `.env`.

## Development

```bash
npm ci
npm ci --prefix chat
npm --prefix chat run dev
```

Then open the single URL printed by Vite. Chat is at `/` and voice is at
`/speech`; both use that same process.

Validate the app with:

```bash
npm run check:demo
```
