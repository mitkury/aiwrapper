# Realtime agents

The experimental realtime agent composes the existing provider abstractions into
a low-latency voice cascade:

```text
microphone -> streaming STT -> ChatAgent -> streaming TTS -> speaker
                              + latest camera frame
```

It is available from an unstable subpath while live interruption and playback
accounting are refined:

```ts
import { Lang } from "aiwrapper";
import { RealtimeAgent } from "aiwrapper/unstable/realtime";
import { SpeechToText, TextToSpeech } from "aiwrapper/unstable/speech";

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

agent.subscribe(event => {
  if (event.type === "audio") speaker.enqueue(event.frame);
  if (event.type === "interrupted") speaker.clear();
});

await agent.connect();
await agent.sendAudio(microphoneFrame);
agent.setImage({ kind: "blob", blob: latestCameraFrame });
```

`RealtimeAgent` keeps one conversation, streams each microphone frame into STT,
passes final utterances to any `LanguageProvider`, and begins TTS at complete
sentence or bounded-clause boundaries while the LLM is still generating. User
speech aborts the current LLM and TTS work so a new turn can begin immediately.
It emits transcript, audio, interruption, turn, and latency events. The latest
camera frame replaces older frames in model context when a new turn starts, so
video history does not make every response progressively slower.

The reusable layer deliberately does not choose WebRTC, WebSocket, SSE, or a
room protocol. Applications supply speech providers and own microphone capture,
speaker playback, camera sampling, credentials, reconnection, and transport.
This lets a small browser demo use same-origin endpoints while production apps
can reuse the orchestration with their own realtime media transport.

## Playground

Run the browser app and open `/realtime`. It provides chat input, live
microphone transcription, streaming speech output, optional camera context,
barge-in interruption, and first-token/first-audio timing. See
[the playground README](../chat/README.md) for environment setup.

Camera context starts off because multimodal requests are slower. Enable it for
turns that need vision. The playground's latency profile also disables optional
reasoning where supported and limits spoken replies to 256 tokens. Regular chat
provider settings are unchanged.

The current playback event means audio was queued by the agent, not necessarily
heard in full. A production application that persists interrupted assistant
messages should report its actual playback cursor before deciding which text
belongs in durable conversation history.
