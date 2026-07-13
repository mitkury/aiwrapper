# Live agent pipeline

Status: proposal

## Goal

Add a transport-independent live agent API to AIWrapper. The first useful mode
should turn microphone audio into text, run the existing language and tool loop,
and turn the answer back into streaming audio.

```text
audio input
  -> turn detection
  -> speech to text
  -> language model and tools
  -> text to speech
  -> audio output
```

This makes ordinary, non-realtime language models usable in a live voice agent.
It also creates a stable event boundary that native speech-to-speech providers
can implement later.

## Boundary

AIWrapper should own:

- normalized audio, transcript, message, tool, and lifecycle types
- orchestration between turn detection, transcription, language, and speech
- cancellation and interruption of the active response
- provider interfaces and small provider adapters
- deterministic mock implementations for tests

Applications should own:

- WebRTC, WebSocket, HTTP, or device transports
- microphone capture and speaker playback
- authentication, rooms, tickets, and reconnect policy
- session persistence and application-specific agent configuration
- application tools, workspaces, triggers, and visual pipelines
- echo cancellation and device audio processing

The live API must work without knowing whether audio came from a browser, a
mobile application, a server-side WebRTC track, or a file.

## Do not extend the current Agent lifecycle

The current `Agent` abstraction represents one `run` lifecycle. A live voice
session is different: it is long-lived, accepts many inputs, can listen while
speaking, and creates multiple cancellable response generations.

Introduce `LiveAgent` and `LiveAgentSession` as separate concepts. They can
reuse `ChatAgent`, `LanguageProvider`, `LangMessage`, and `LangMessages`
internally without changing the meaning of `Agent.run`.

## Public shape

The exact names can change during implementation, but the public contract
should stay close to this:

```ts
type PcmAudioFrame = {
  samples: Int16Array;
  sampleRate: number;
  channels: 1;
  timestampMs?: number;
};

type LiveAgentEvent =
  | { type: "session_state"; state: "starting" | "ready" | "closed" }
  | { type: "user_speech_started"; turnId: string }
  | { type: "user_speech_ended"; turnId: string }
  | { type: "user_transcript_delta"; turnId: string; text: string }
  | { type: "user_transcript_final"; turnId: string; text: string }
  | { type: "assistant_text_delta"; generationId: string; text: string }
  | { type: "assistant_text_final"; generationId: string; text: string }
  | { type: "assistant_audio"; generationId: string; frame: PcmAudioFrame }
  | { type: "tool_call"; generationId: string; callId: string; name: string; arguments: object }
  | { type: "tool_result"; generationId: string; callId: string; name: string; result: unknown }
  | { type: "interrupted"; generationId: string; reason: string }
  | { type: "error"; error: Error; recoverable: boolean };

interface LiveAgentSession {
  start(): Promise<void>;
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  commitAudio(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendImage(image: LangImageInput): Promise<void>;
  interrupt(reason?: string): void;
  subscribe(listener: (event: LiveAgentEvent) => void): () => void;
  close(): Promise<void>;
}
```

`appendAudio` accepts audio without assuming that AIWrapper owns the transport.
`commitAudio` is an explicit end-of-turn signal. An optional turn detector can
call the same operation automatically.

`sendText` bypasses transcription but uses the same language and speech output
path. `sendImage` queues visual context for the next user turn instead of
creating a video transport abstraction.

## Audio contract

Use mono signed 16-bit PCM frames at the public boundary. Every frame includes
its sample rate. Provider adapters are responsible for resampling or encoding
when their APIs require another format.

Do not expose `Buffer`, filesystem paths, object URLs, or provider-specific
audio payloads in the shared API. `Int16Array` works in Node.js and browsers and
matches the server-side media shape needed by applications such as
WorldAgents.

The session must use bounded queues. If input arrives faster than it can be
processed, it should apply backpressure or emit an explicit overflow error. It
must not allow an unbounded audio buffer.

## Pipeline components

### Turn detection

Turn detection decides when an utterance begins and ends. It should be a small
optional interface, not a required model dependency in the core package.

```ts
interface TurnDetector {
  process(frame: PcmAudioFrame): TurnDetectionEvent[];
  reset(): void;
}
```

The first implementation should support explicit `commitAudio` calls. A robust
VAD adapter can be added separately. A simple energy threshold may be useful in
tests and demos, but should not be presented as production-quality VAD.

### Speech to text

Speech recognition needs a session interface because some providers stream
partial transcripts while others transcribe a completed utterance.

```ts
interface SpeechToTextProvider {
  createSession(options: {
    signal: AbortSignal;
    onTranscript(event: TranscriptEvent): void;
  }): Promise<SpeechToTextSession>;
}

interface SpeechToTextSession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  finish(): Promise<string>;
  close(): Promise<void>;
}
```

A non-streaming provider can buffer one bounded utterance and transcribe it in
`finish`. A streaming provider can emit deltas while frames arrive.

### Language and tools

The pipeline should reuse `LanguageProvider`, `LangMessages`, and the existing
tool representation. It should not introduce another message model.

Before this integration, language providers need a manual tool execution mode.
Today provider calls automatically execute local handlers. Applications that
own their tool loop need to receive normalized tool requests, run them, append
tool results, and continue the model turn themselves.

Add a backward-compatible option resembling:

```ts
type LangOptions = {
  toolExecution?: "automatic" | "manual";
};
```

The default remains `automatic`. The live pipeline can use automatic execution.
An application-owned loop can select `manual`.

Tool handlers should also receive an optional context containing the call id,
tool name, and turn `AbortSignal`. This allows applications to emit precise tool
lifecycle events and cancel in-flight tools.

### Text to speech

Text-to-speech output must be cancellable and stream PCM frames.

```ts
interface TextToSpeechProvider {
  speak(
    text: AsyncIterable<string>,
    options: { signal: AbortSignal; voice?: string },
  ): AsyncIterable<PcmAudioFrame>;
}
```

The pipeline should buffer language deltas into speakable segments rather than
calling TTS for every token. Sentence boundaries are a reasonable default. A
provider with native streaming text input can consume the same async text
stream with less buffering.

TTS adapters must stop producing frames promptly after cancellation. Every
audio event includes a generation id so an application can discard late frames
from an interrupted response.

## Turns and interruption

Each committed user utterance creates a turn. Each assistant response creates a
generation with its own `AbortController`.

When new user speech starts while an assistant generation is active:

1. Abort the active language and TTS operations.
2. Clear queued assistant audio for that generation.
3. Emit `interrupted` with the generation id.
4. Continue collecting the new user utterance.

Already played audio cannot be retracted. Applications should stop playback for
the interrupted generation as soon as they receive the event.

Session shutdown uses a separate session-level abort signal. Closing a session
must close STT and TTS resources, abort the current generation, clear queues,
and make later input fail predictably.

## Conversation ordering

The initial implementation should process one committed user turn at a time.
If another turn is committed while transcription or generation is active, the
configured policy should be explicit:

- `interrupt`: cancel the active response and process the newer turn
- `queue`: finish the active response, then process the next turn
- `reject`: return a recoverable busy error

Voice agents should default to `interrupt`. Text-only callers may prefer
`queue`.

## Native realtime providers

Native speech-to-speech providers should eventually implement the same
`LiveAgentSession` event boundary through a separate backend. They bypass the
STT, text-model, and TTS pipeline but still emit normalized transcripts, audio,
tool calls, interruption, and lifecycle events.

```text
LiveAgent.pipeline({ turnDetector, stt, language, tts })
LiveAgent.realtime({ provider })
```

Do not stabilize the native realtime provider interface around a single model.
Implement the pipeline first, then compare at least two native providers before
freezing that lower-level contract.

## WorldAgents integration

WorldAgents can add a future voice-pipeline AgentStack as a thin adapter:

```text
WebRTC microphone frames
  -> liveSession.appendAudio

WorldAgents VAD or end-of-turn event
  -> liveSession.commitAudio

liveSession assistant_audio events
  -> WorldAgents audioOutput

liveSession transcript and tool events
  -> WorldAgents data channel and session persistence

WorldAgents interrupt event
  -> liveSession.interrupt
```

WorldAgents should continue to own its AgentStack registry, session runtime
instructions, tools, triggers, persistence, reconnect behavior, and visual
pipelines. AIWrapper supplies the reusable conversational media pipeline.

The first integration should use AIWrapper only for a WorldAgents text adapter.
That proves provider switching, normalized messages, streaming, images, tools,
and cancellation before audio complexity is added.

## Suggested implementation stages

### Stage 1: language loop readiness

- add manual tool execution to `LangOptions`
- pass tool call context and cancellation to handlers
- add normalized streaming events or a reliable delta adapter
- use the configurable `ChatAgent` iteration limit to bound each text turn
- test automatic and application-owned tool loops

### Stage 2: live core and mocks

- add audio and event types under `src/live`
- add `LiveAgent` and `LiveAgentSession`
- implement explicit audio commit and text input
- implement bounded queues and generation cancellation
- add mock STT and TTS providers
- test ordering, interruption, stale-frame rejection, and cleanup

### Stage 3: first useful pipeline

- add one server-capable STT adapter
- add one PCM-streaming TTS adapter
- combine them with any existing `LanguageProvider`
- add a Node example that accepts explicit utterance boundaries
- keep provider integration tests credential-gated

An OpenAI transcription and speech pair is a reasonable first implementation
because it minimizes the number of credentials while allowing any AIWrapper
language provider in the middle. The design must not make them required.

### Stage 4: automatic turns and application adapter

- add a production VAD adapter as an optional integration
- add speech-start interruption
- add a WorldAgents AgentStack adapter and end-to-end mock test
- measure transcription, first-token, first-audio, and total turn latency

### Stage 5: native realtime

- implement two native speech-to-speech providers
- compare their audio, transcript, tool, interruption, and reconnect behavior
- stabilize a shared native realtime provider contract

## Testing

Deterministic tests must not require audio devices, WebRTC, network access, or
provider keys.

Use synthetic PCM frames and mocks to test:

- explicit and automatic turn boundaries
- partial and final transcripts
- streaming language output and TTS segmentation
- tools followed by a final spoken response
- interruption during transcription, language generation, tool execution, and TTS
- late events from an aborted generation
- bounded input and output queues
- close during every pipeline stage
- Node.js and browser-compatible public types

Provider tests should remain separate integration tests and skip cleanly when
credentials are missing.

## Non-goals

- implementing WebRTC or a room service in AIWrapper
- managing workers or routing application sessions
- owning application persistence, auth, or reconnect policy
- shipping a heavyweight VAD model as a mandatory dependency
- decoding arbitrary compressed audio formats in the core package
- replacing the existing text `Agent` and `ChatAgent` APIs
- copying product-specific AgentStack configuration into AIWrapper

## Decisions to confirm

- Use explicit audio commits as the first turn-boundary mechanism.
- Use mono `Int16Array` PCM as the public audio representation.
- Keep VAD implementations optional.
- Keep WebRTC and playback outside AIWrapper.
- Add manual tool execution before building the live pipeline.
- Build the composable STT to language to TTS pipeline before native realtime providers.
