# Speech

`SpeechToText` and `TextToSpeech` are available from `aiwrapper` and
`aiwrapper/speech`. For native speech-to-speech models use
[LiveLang](live-sessions.md); for an STT → LLM → TTS pipeline use
[RealtimeAgent](realtime-agent.md).

## PCM contract

```ts
import type { PcmAudioFrame } from "aiwrapper";

const frame: PcmAudioFrame = {
  encoding: "pcm_s16le",
  samples: new Int16Array(480),
  sampleRate: 24000,
  channels: 1,
};
```

Frames contain mono signed 16-bit little-endian PCM. Read each provider's
`inputFormat` or `outputFormat`; AIWrapper does not resample. Transcription
sessions reject sample-rate changes within an utterance. Capture, resampling,
playback, and transport belong to the application.

HTTP adapters use standard web APIs. Default realtime WebSockets use Node's
`ws` package; browser callers need an appropriate `createWebSocket` transport.
Keep long-lived credentials on a server and account for provider CORS rules.

## Speech to text

| Factory | Behavior |
| --- | --- |
| `SpeechToText.openai()` | Buffers an utterance and sends WAV to file transcription; bounded by `maxAudioBytes` |
| `SpeechToText.openaiRealtime()` | Streams 24 kHz PCM over a persistent connection |
| `SpeechToText.deepgramFlux()` | Streams PCM with provider turn detection |
| `SpeechToText.elevenlabsRealtime()` | Streams PCM with manual or VAD commit strategy |

```ts
import { SpeechToText } from "aiwrapper";

const stt = SpeechToText.openaiRealtime({
  apiKey: process.env.OPENAI_API_KEY!,
});
const session = await stt.createSession({
  onTranscript: event => console.log(event),
  onSpeechActivity: event => console.log(event),
});
try {
  await session.appendAudio(frame);
  const transcript = await session.commit();
  console.log(transcript.text);
} finally {
  await session.close();
}
```

`commit()` completes an utterance; `finish()` completes it and ends the session.
With OpenAI Realtime, wait for `commit()` before appending the next utterance.
Use `onTranscript` for streaming updates and `onSpeechActivity` where supported.
Final transcript events may repeat an `id`; replace that entry instead of
appending a duplicate. Pass an `AbortSignal` to `createSession()` to cancel.
The shared STT contract has no asynchronous error callback; operations reject
when the connection fails.

For OpenAI's `gpt-live-transcribe`, select `turnDetection: { type: "local_vad" }`.
This adapter sends `turn_detection: null`, maps `language` to `languages`, and
accepts `delay: "minimal" | "low" | "medium" | "high" | "xhigh"`.

Deepgram and ElevenLabs declare their configured sample rate; both default to
24 kHz in this wrapper. Their constructor options control language hints and
turn-detection thresholds. See the [exported speech types](../src/speech/index.ts)
for provider options rather than assuming all adapters accept the same settings.

## Text to speech

```ts
import { TextToSpeech } from "aiwrapper";

const tts = TextToSpeech.elevenlabs({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: process.env.ELEVENLABS_VOICE_ID!,
  sampleRate: 24000,
});
for await (const frame of tts.speak("Hello", { signal })) {
  speaker.enqueue(frame); // Application-owned PCM playback.
}
```

`TextToSpeech.openai()` emits 24 kHz PCM. ElevenLabs supports 8, 16, 22.05, 24,
44.1, and 48 kHz, subject to provider/model restrictions. Aborting `signal` or
stopping iteration cancels the active request and response reader.

ElevenLabs also supports incremental text over a WebSocket:

```ts
const stream = await tts.createStreamingSession({ signal });
try {
  stream.appendText("Hello. ");
  stream.flush();
  stream.appendText("How can I help?");
  stream.endInput();
  for await (const frame of stream) speaker.enqueue(frame);
} finally {
  await stream.close();
}
```

`createStreamingSession` is optional on the shared TTS interface. Providers
without it accept complete text segments through `speak()`.
`RealtimeAgent` handles that distinction and text segmentation.

## Mocks and playback

`SpeechToText.mock()` supplies fixed transcripts; `TextToSpeech.mock()` supplies
PCM frames and records `spokenTexts`. Use them for deterministic tests.

Generated or queued audio does not prove which words the user heard. Persisting
an interrupted conversation requires an application-owned playback cursor.
See [testing](../tests/README.md) for mocks and credential-gated live checks.
