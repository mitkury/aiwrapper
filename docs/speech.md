# Speech providers

Speech support is available from the unstable subpath while interruption is
being tested in a real voice application:

```ts
import { SpeechToText, TextToSpeech } from "aiwrapper/unstable/speech";
```

The unstable label means the speech API may change in a normal release. It does
not change the stability of the main `aiwrapper` entrypoint.

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
  onTranscript: event => console.log(event),
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
`gpt-live-transcribe`. One utterance is processed at a time: wait for
`commit()` to return before appending the next utterance. Safely overlapping
turns would require provider item IDs in the shared contract.

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
  onTranscript: event => console.log(event),
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
