# Realtime agents

`RealtimeAgent` composes streaming STT, a `ChatAgent`, and TTS. Native models
such as Gemini Live use the separate [LiveLang interface](live-sessions.md).

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
    instructions: "Keep spoken answers brief.",
  },
);

agent.subscribe(event => {
  if (event.type === "audio") speaker.enqueue(event.frame);
  if (event.type === "interrupted") speaker.clear();
});
await agent.connect();
await agent.sendAudio(microphoneFrame);
agent.setImage({ kind: "blob", blob: latestCameraFrame });
// Later:
await agent.close();
```

The application supplies `speaker`, microphone PCM, and optional camera images.
Choose speech providers with compatible formats or resample at that boundary.
Pass `signal` to `connect()` to cancel the session.

## Turns

Final transcripts enter the shared conversation. LLM deltas go directly to TTS
when it supports incremental input; otherwise the agent sends sentence or
bounded-clause segments. Audio stays in text order. User speech aborts current
LLM/TTS work and emits `interrupted` so the application can clear playback.

`sendText()` starts a text turn, `commitAudio()` commits an utterance explicitly,
and `interrupt()` stops the current response. `setImage()` replaces the previous
camera frame for the next turn. `messages` exposes the conversation.
See the [options and implementation](../src/realtime/realtime-agent.ts) for
custom tools, model iteration limits, and text segmentation.

Events include transcripts, speech activity, audio, interruptions, completed
turns, errors, and latency milestones. Latencies are wall-clock intervals;
LLM generation and TTS overlap. Audio delivery means queued audio, so durable
interrupted history still requires the application's actual playback cursor.

## Playground

The [playground](../playground/README.md) runs this pipeline at `/realtime`, with
independent STT, LLM, and TTS controls and optional camera input. Its server owns
providers and conversation state; the browser captures media and plays PCM.
The reusable agent does not select a media transport, manage credentials, or
persist sessions.
