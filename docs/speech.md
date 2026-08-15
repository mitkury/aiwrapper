# Speech providers

Speech-to-text and text-to-speech providers are part of the main package:

```ts
import { SpeechToText, TextToSpeech } from "aiwrapper";
```

The focused `aiwrapper/speech` subpath exports the same factories, provider
classes, contracts, and audio helpers. Realtime agent orchestration remains
experimental under `aiwrapper/unstable/realtime`.

Native speech-to-speech models use a separate experimental API because they
keep one live audio conversation instead of exposing independent transcription
and synthesis steps:

```ts
import {
  SpeechToSpeech,
  type SpeechToSpeechEvent,
} from "aiwrapper/unstable/speech";

const provider = SpeechToSpeech.openaiRealtime({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-realtime-2.1",
  voice: "marin",
});

const session = await provider.createSession({
  instructions: "Be concise and helpful.",
  onEvent(event) {
    if (event.type === "output-audio") speaker.push(event.frame);
    if (event.type === "input-transcript") {
      console.log("user", event.transcript);
    }
    if (event.type === "output-transcript") {
      console.log("assistant", event.transcript);
    }
    if (event.type === "response-interrupted") speaker.clear();
    if (event.type === "error") console.error(event.error);
  },
});

await session.appendAudio(microphoneFrame);
await session.close();
```

`onEvent` remains convenient during session construction. A created session is
also an observable event source, so independent consumers can subscribe without
combining callbacks themselves:

```ts
const logEvent = (event: SpeechToSpeechEvent) => console.log(event);
const clearPlayback = () => speaker.clear();

session.addEventListener("event", logEvent); // every normalized event
session.addEventListener("response-interrupted", clearPlayback);

session.removeEventListener("response-interrupted", clearPlayback);
session.removeEventListener("event", logEvent);
```

Specific event names are type-narrowed. Observer errors are isolated from the
provider stream and from other observers. Provider adapters continue to expose
one normalized event vocabulary: transcripts, output audio, response start,
response completion, interruption, and errors.

Applications can also subscribe to provider-neutral turn milestones without
reimplementing the Playground timeline:

```ts
import { observeSpeechToSpeechTimeline } from "aiwrapper/unstable/speech";

const stopTimeline = observeSpeechToSpeechTimeline(session, (milestone) => {
  timelineView.update(milestone);
});

stopTimeline();
```

Milestones include input start and final, response start, first text, first
audio, response end, interruption, and error. Each includes a turn ID and the
milliseconds elapsed since that turn's first observed event. Session connection
timing remains application-owned because it begins before a session exists.

Change only provider construction to use Gemini Live:

```ts
const provider = SpeechToSpeech.geminiLive({
  apiKey: process.env.GOOGLE_API_KEY!,
  model: "gemini-3.1-flash-live-preview",
  voice: "Kore",
});
```

Or use xAI Voice through the same session interface:

```ts
const provider = SpeechToSpeech.xaiVoice({
  apiKey: process.env.XAI_API_KEY!,
  model: "grok-voice-think-fast-2.0",
  voice: "eve",
});
```

Azure Voice Live is another drop-in provider:

```ts
const provider = SpeechToSpeech.azureVoiceLive({
  endpoint: process.env.AZURE_VOICE_LIVE_ENDPOINT!,
  apiKey: process.env.AZURE_VOICE_LIVE_API_KEY!,
  model: "gpt-realtime",
  voice: "alloy",
});
```

Amazon Nova 2 Sonic uses the standard AWS SDK credential chain and Bedrock's
bidirectional streaming API:

```ts
const provider = SpeechToSpeech.amazonNovaSonic({
  region: process.env.AWS_REGION ?? "us-east-1",
  model: "amazon.nova-2-sonic-v1:0",
  voice: "tiffany",
});
```

OpenAI, Gemini, xAI, and Azure use one persistent server-side WebSocket per
session. Nova keeps the same public session interface over one Bedrock HTTP/2
bidirectional stream. All providers manage turn taking themselves. OpenAI,
xAI, and Azure declare 24 kHz input and output. Gemini and Nova declare 16 kHz
input and 24 kHz output. Applications should read
`provider.inputFormat` and resample explicitly at the microphone boundary when
needed. The shared API does not expose provider-specific transport messages.

Final transcript events may include an `id`. Providers can revise a transcript
for the same utterance more than once, so interfaces that render conversation
bubbles should replace an existing entry with the same ID instead of appending
a duplicate.

`SpeechToSpeech.mock()` records received frames and can emit deterministic
audio, transcripts, delays, and interruption events for application tests.
The initial API deliberately leaves microphone capture, playback, resampling,
tools, text input, reconnection, and portable session state to the application.

## Audio contract

Speech providers use mono signed 16-bit little-endian PCM represented as an
`Int16Array`. Every frame declares its encoding, sample rate, and channel count:

```ts
type PcmAudioFrame = {
  encoding: "pcm_s16le";
  samples: Int16Array;
  sampleRate: number;
  channels: 1;
  timestampMs?: number;
};
```

AIWrapper does not silently resample audio. A speech-to-text session rejects a
sample-rate change within an utterance. Each text-to-speech provider exposes its
exact `outputFormat`, and every emitted frame repeats that format.

The shared API does not expose Node.js `Buffer`, filesystem paths, object URLs,
or compressed provider payloads. The PCM contracts, batch transcription, and
HTTP text-to-speech adapters use standard web APIs available in Node.js 20 and
modern browsers, subject to each provider's CORS and credential constraints.

## Speech to text

Speech-to-text keeps a session interface so batch and streaming providers fit
the same application code. Use the realtime adapter for live voice pipelines:

```ts
const speechToText = SpeechToText.openaiRealtime({
  apiKey: process.env.OPENAI_API_KEY!,
});

const session = await speechToText.createSession({
  signal: voiceSessionAbortController.signal,
  onTranscript: (event) => console.log(event),
});

// OpenAI Realtime declares 24 kHz input. Resampling belongs at the application
// boundary so it is explicit rather than silently performed by AIWrapper.
await session.appendAudio({
  encoding: "pcm_s16le",
  samples,
  sampleRate: 24000,
  channels: 1,
});

// Commit each detected utterance without closing the provider connection.
const transcript = await session.commit();
await session.close();
```

`SpeechToText.openaiRealtime()` uses a persistent server-side WebSocket,
streams each appended PCM frame immediately, emits transcript deltas, and
returns the final transcript for each `commit()`. It defaults to
`gpt-4o-mini-transcribe`. One utterance is processed at a time: wait for
`commit()` to return before appending the next utterance. Safely overlapping
turns would require provider item IDs in the shared contract.

`gpt-live-transcribe` does not accept `server_vad` in this transcription path. Select
`turnDetection: { type: "local_vad" }` to detect speech in the incoming PCM on
the application server and commit after the configured silence interval. The
adapter sends `turn_detection: null`, translates a singular `language` hint to
the model's `languages` field, and accepts its `delay` setting (`minimal`,
`low`, `medium`, `high`, or `xhigh`).

The realtime adapter's default WebSocket transport uses the Node.js `ws`
package. A browser application must provide `createWebSocket` through a secure
server or short-lived-token design; do not expose a permanent provider API key
in browser code.

Use the batch adapter for recorded audio or as a fallback:

```ts
const speechToText = SpeechToText.openai({
  apiKey: process.env.OPENAI_API_KEY!,
});

const session = await speechToText.createSession({
  signal: turnAbortController.signal,
  onTranscript: (event) => console.log(event),
});

await session.appendAudio({
  encoding: "pcm_s16le",
  samples,
  sampleRate: 48000,
  channels: 1,
});

const transcript = await session.finish(); // commits and ends this session
await session.close();
```

The batch OpenAI adapter buffers one bounded utterance, writes a WAV header
around the PCM without resampling it, and calls the file transcription
endpoint. The default model is `gpt-transcribe`; pass `model` to select another
supported transcription model. The default input limit leaves room below the
provider's 25 MB file limit and can be lowered with `maxAudioBytes`.

## Text to speech

Text-to-speech emits frames as soon as raw PCM bytes arrive from the provider:

```ts
const textToSpeech = TextToSpeech.elevenlabs({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: process.env.ELEVENLABS_VOICE_ID!,
  sampleRate: 24000,
});

for await (const frame of textToSpeech.speak("First, remove the panel.", {
  signal: turnAbortController.signal,
})) {
  audioOutput.push(frame);
}
```

Call `speak()` once per speakable segment. Segmenting text belongs to the
application because it also owns playback accounting and interrupted history.
Do not call it for every token and do not combine a whole long response when
clause-level interruption matters.

Available adapters:

- `TextToSpeech.openai()` emits 24 kHz PCM, the format documented by the OpenAI
  speech endpoint.
- `TextToSpeech.elevenlabs()` supports explicit PCM rates of 8, 16, 22.05, 24,
  44.1, and 48 kHz. Provider plan and model restrictions still apply.

Aborting the supplied signal cancels the HTTP request and the active response
body reader. Stopping iteration early also cancels the response body.

Provider references:

- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI speech generation](https://developers.openai.com/api/docs/guides/text-to-speech)
- [ElevenLabs streaming speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)
- [Amazon Nova 2 Sonic bidirectional events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-input-events.html)
- [Azure Voice Live API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-api-reference-2026-04-10)

## Mocks

Mocks ship with the provider contracts so interruption tests do not need
credentials, audio devices, or network access:

```ts
const speechToText = SpeechToText.mock({ transcript: "Stop there." });
const textToSpeech = TextToSpeech.mock({
  sampleRate: 24000,
  frames: [new Int16Array([0, 1, 2])],
  delayMs: 20,
});
```

`MockTextToSpeech.spokenTexts` records each segment passed to `speak()`.

## Application boundary

AIWrapper supplies interchangeable language, transcription, and speech
providers. A live application should continue to own:

- microphone and speaker transports
- VAD and utterance boundaries
- response segmentation and speech queues
- the cursor that measures what audio was actually played
- interruption history and unspoken text
- persistence, reconnection, tools, and product-specific stack selection

This boundary matters for interrupted turns. Generated text and synthesized
audio do not prove that the user heard them. A session abstraction cannot write
honest history unless the application gives it a playback cursor. AIWrapper
therefore keeps microphone, speaker, and durable interruption accounting at the
application boundary. The experimental
[`RealtimeAgent`](realtime-agent.md) composes the provider cascade and emits the
events an application needs without choosing its media transport.
