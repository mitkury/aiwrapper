# Realtime agents

The realtime agent composes the existing provider abstractions into a
low-latency voice cascade:

```text
microphone -> streaming STT -> ChatAgent -> streaming TTS -> speaker
                              + latest camera frame
```

```ts
import { Lang, RealtimeAgent, SpeechToText, TextToSpeech } from "aiwrapper";

const agent = new RealtimeAgent(
  Lang.openai({ apiKey: process.env.OPENAI_API_KEY! }),
  {
    speechToText: SpeechToText.openaiRealtime({
      apiKey: process.env.OPENAI_API_KEY!,
      turnDetection: { type: "server_vad", silence_duration_ms: 400 },
    }),
    textToSpeech: TextToSpeech.openai({
      apiKey: process.env.OPENAI_API_KEY!,
      voice: "coral",
    }),
    instructions: "Answer briefly and naturally for speech.",
  },
);

agent.subscribe((event) => {
  if (event.type === "audio") speaker.enqueue(event.frame);
  if (event.type === "interrupted") speaker.clear();
});

await agent.connect();
await agent.sendAudio(microphoneFrame);
agent.setImage({ kind: "blob", blob: latestCameraFrame });
```

`RealtimeAgent` keeps one conversation, streams each microphone frame into STT,
passes final utterances to any `LanguageProvider`, and sends LLM deltas directly
to TTS providers that support incremental text input. Sentence boundaries ask
those providers to flush audio early; the end of the LLM stream flushes the
remaining text. For providers that only accept one text request at a time, the
agent falls back to complete sentence or bounded-clause segments and starts the
next request while earlier audio is still being delivered. Audio remains in
text order in both cases. User speech aborts the current LLM and TTS work so a
new turn can begin immediately.
It emits transcript, audio, interruption, turn, and latency events. The latest
camera frame replaces older frames in model context when a new turn starts, so
video history does not make every response progressively slower.

The reusable layer deliberately does not choose WebRTC, WebSocket, SSE, or a
room protocol. Applications supply speech providers and own microphone capture,
speaker playback, camera sampling, credentials, reconnection, and transport.
This lets the browser playground use a same-origin server session while
production apps can reuse the orchestration with their own realtime media
transport.

## Playground

Run the browser app and open `/realtime`. It provides chat input, live
microphone transcription, streaming speech output, optional camera context,
barge-in interruption, and a per-turn latency waterfall. The waterfall separates
STT finalization, input preparation, LLM wait, text segmentation, TTS provider
wait, and completion.

The playground browser is a thin media/UI client. A Node-side session owns the
selected STT, language, and TTS providers and the `RealtimeAgent`; it streams
provider-neutral events and binary PCM back to the page. This keeps credentials,
turn detection, conversation state, tool execution, interruption, and provider
errors on the server while leaving the regular chat playground unchanged.
Its values are wall-clock intervals; LLM generation and TTS overlap after audio
starts. See
[the playground README](../playground/README.md) for environment setup.

The separate `/speech-to-speech` page tests native live models through
`LiveLang`. It bypasses the STT, language, and TTS cascade while keeping the
same browser microphone and PCM playback boundary.

Camera context starts off because multimodal requests are slower. Enable it for
turns that need vision. The playground's latency profile also disables optional
reasoning where supported and limits spoken replies to 256 tokens. Regular chat
provider settings are unchanged.

The current playback event means audio was queued by the agent, not necessarily
heard in full. A production application that persists interrupted assistant
messages should report its actual playback cursor before deciding which text
belongs in durable conversation history.
