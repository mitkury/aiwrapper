# Speech-to-speech providers

Status: proposed

## Decision

AIWrapper should add a small `SpeechToSpeechProvider` abstraction for native
live voice models that continuously accept audio and continuously produce audio.

It should live beside the existing `SpeechToText` and `TextToSpeech` contracts
under `aiwrapper/unstable/speech` rather than replacing them.

The goal is simple: an application should be able to switch between OpenAI
Realtime, Gemini Live, and self-hosted full-duplex models without changing its
microphone, playback, or conversation code.

```text
microphone PCM
    |
    v
SpeechToSpeechProvider
    |
    +-- OpenAI Realtime
    +-- Gemini Live
    +-- PersonaPlex / Moshi / another self-hosted model
    |
    v
speaker PCM
```

The first version should cover only the common live-audio path. Provider-specific
features can be added after the basic abstraction has been proven with at least
two cloud providers and one self-hosted model.

## Why this is separate from STT + LLM + TTS

The existing speech stack is useful when the application wants exact control:

```text
audio -> STT -> language model -> TTS -> audio
```

Native live models are a different kind of provider. They keep a persistent
conversation, consume audio while the conversation is running, and emit audio
incrementally. Some are full duplex and can listen while speaking.

Trying to represent them as separate `SpeechToText` and `TextToSpeech`
providers would throw away the main reason to use them: the model owns the
continuous audio context, timing, prosody, and turn behavior.

We should therefore support both approaches:

- `SpeechToText` + language provider + `TextToSpeech` for controlled pipelines.
- `SpeechToSpeech` for native live voice models.

## Proposed API

The application-facing API should look similar to the existing speech APIs:

```ts
import { SpeechToSpeech } from "aiwrapper/unstable/speech";

const provider = SpeechToSpeech.openaiRealtime({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-realtime-2.1",
  voice: "marin",
});

const session = await provider.createSession({
  instructions: "Be concise and helpful.",
  signal: sessionAbortController.signal,
  onEvent(event) {
    if (event.type === "output-audio") {
      audioOutput.push(event.frame);
    }

    if (event.type === "input-transcript") {
      console.log("user", event.transcript);
    }

    if (event.type === "output-transcript") {
      console.log("assistant", event.transcript);
    }

    if (event.type === "response-interrupted") {
      audioOutput.clearQueuedAudio();
    }
  },
});

for await (const frame of microphoneFrames) {
  await session.appendAudio(frame);
}

await session.close();
```

Switching provider should only change construction:

```ts
const provider = SpeechToSpeech.geminiLive({
  apiKey: process.env.GOOGLE_API_KEY!,
  model: "gemini-3.1-flash-live-preview",
  voice: "Kore",
});
```

A self-hosted adapter should implement the same exported provider interface:

```ts
const provider = new PersonaPlexSpeechToSpeech({
  url: "wss://voice.internal.example",
});
```

The concrete model names are configuration, not part of the shared contract.
For OpenAI, the public Realtime models can use this adapter now; a future
API-accessible GPT-Live model should fit the same provider without changing the
application API.

## Contract

Reuse the existing PCM types and transcript events.

```ts
type SpeechToSpeechEvent =
  | { type: "output-audio"; frame: PcmAudioFrame }
  | { type: "input-transcript"; transcript: TranscriptEvent }
  | { type: "output-transcript"; transcript: TranscriptEvent }
  | { type: "response-start" }
  | { type: "response-end" }
  | { type: "response-interrupted" };

type SpeechToSpeechSessionOptions = {
  signal?: AbortSignal;
  instructions?: string;
  onEvent?: (event: SpeechToSpeechEvent) => void;
};

interface SpeechToSpeechSession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  close(): Promise<void>;
}

interface SpeechToSpeechProvider {
  readonly inputFormat: PcmAudioFormat;
  readonly outputFormat: PcmAudioFormat;

  createSession(
    options?: SpeechToSpeechSessionOptions,
  ): Promise<SpeechToSpeechSession>;
}
```

`output-audio` is the only event every implementation must produce. Transcript
and response-boundary events are emitted when the provider exposes reliable
information for them. A genuinely continuous full-duplex model may not have a
useful concept of discrete response boundaries.

The provider should declare one exact preferred input and output PCM format.
AIWrapper should keep the existing rule that it does not silently resample.
The application can explicitly resample microphone audio when switching to a
provider with a different input rate.

## Turn taking and interruption

The first version should use **provider/model-managed turn taking**.

This keeps the contract small and works with the main target systems:

- OpenAI Realtime can use its server-side turn detection and interruption.
- Gemini Live performs live turn handling and reports when a response is
  interrupted.
- Full-duplex models such as PersonaPlex or Moshi continuously consume both
  sides and do not require an explicit `commit()` per user utterance.

The application still owns actual playback. When a provider reports
`response-interrupted`, the application clears audio that has not yet played.
This matches the existing rule that generated audio is not proof that the user
heard it.

Manual VAD, explicit `commitInput()`, `cancelResponse()`, and custom turn policy
can be added later if a real application needs the same primitive across more
than one provider. They should not block the first implementation.

## Provider adapters

### 1. OpenAI Realtime

Add `SpeechToSpeech.openaiRealtime()`.

The adapter should:

- keep one persistent Realtime connection per session;
- configure audio input and audio output;
- send each PCM frame as soon as `appendAudio()` receives it;
- convert provider audio events into `output-audio` frames;
- map available input/output transcription events;
- map response start/end/interruption events when available;
- close the connection on session abort or `close()`.

Use the current public Realtime model as the default in implementation tests,
but keep `model` configurable so the adapter does not depend on one model name.

### 2. Gemini Live

Add `SpeechToSpeech.geminiLive()`.

Gemini Live already has a very similar wire shape: a persistent WebSocket,
raw 16-bit PCM input, raw 16-bit PCM output, optional input/output
transcriptions, and interruption events.

The adapter should normalize those messages into the same session events as the
OpenAI adapter.

### 3. Mock

Add `SpeechToSpeech.mock()` before the network adapters.

The mock should be able to:

- record received PCM frames;
- emit deterministic output PCM frames;
- emit transcript events;
- emit `response-interrupted` at a configured point;
- delay output to test streaming and cancellation.

This gives consuming applications a way to test live voice behavior without an
audio device, GPU, or provider credentials.

### 4. Self-hosted model

After the two cloud adapters work, add one small reference adapter for a
self-hosted full-duplex model such as PersonaPlex or Moshi.

This is important because it proves the abstraction is about speech-to-speech
models rather than about normalizing two commercial APIs. The shared contract
must not depend on OpenAI or Gemini event names, auth, session limits, or tool
semantics.

## Transport

The shared API should not expose WebSocket or WebRTC details.

For the first implementation, follow the existing realtime transcription
adapter and use a persistent server-side WebSocket by default. Allow an injected
WebSocket factory where needed for other runtimes.

Browser-direct WebRTC, ephemeral browser credentials, SIP, reconnection, and
provider-specific session resumption can be added behind the same provider
interface later. None of those should change how the application supplies and
receives PCM frames.

## Session switching

"Swappable" means the application can choose another provider or model when it
creates a session.

It does **not** mean transparently hot-swapping a model in the middle of an
active conversation. Native speech models keep provider-specific audio and
conversation state that cannot generally be transferred losslessly.

If an application wants to move an ongoing conversation to another provider, it
should close the old session, create a new one, and seed the new session with a
text transcript or summary. Portable live-session state is a separate problem.

## Delivery order

1. Add `SpeechToSpeechProvider`, `SpeechToSpeechSession`, events, and mock under
   `src/unstable/speech`.
2. Add deterministic unit tests for PCM validation, streaming events, abort, and
   close.
3. Implement `SpeechToSpeech.openaiRealtime()` using the same WebSocket helpers
   already used by realtime transcription.
4. Implement `SpeechToSpeech.geminiLive()`.
5. Add credential-gated integration tests that stream a short PCM fixture and
   verify that output PCM is produced.
6. Add one self-hosted PersonaPlex or Moshi adapter to validate that the
   abstraction is provider-neutral.
7. Only then consider text input, tools, explicit turn commits, manual response
   cancellation, images/video, browser WebRTC, and session resumption.

## Non-goals for v1

- Replacing the existing STT + LLM + TTS pipeline
- Microphone capture, speaker playback, echo cancellation, or resampling
- A high-level `VoiceAgent` or live-session orchestrator
- Tool calling and tool-result normalization
- Text, image, or video input
- Universal manual VAD or turn-boundary APIs
- Hot-swapping models inside an active live session
- Normalizing every provider-specific voice or generation option

Provider-specific construction options should stay typed on each adapter rather
than growing one lowest-common-denominator configuration object.

## Success criteria

The abstraction is successful when the same small application loop can:

1. stream microphone PCM into OpenAI Realtime and play its output;
2. change only provider construction and do the same with Gemini Live;
3. change only provider construction and do the same with one self-hosted
   full-duplex model;
4. receive interruption/transcript information when a provider supplies it;
5. test all application logic with the mock and no network connection.

At that point AIWrapper has a useful provider-neutral primitive for native live
voice without trying to become a complete voice-agent framework.

## References

- [Existing AIWrapper speech contract](../../speech.md)
- [OpenAI GPT-Realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
- [Gemini 3.1 Flash Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview)
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [NVIDIA PersonaPlex](https://github.com/NVIDIA/personaplex)
- [Kyutai Moshi](https://github.com/kyutai-labs/moshi)
