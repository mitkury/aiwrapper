# Interruption detection

Status: proposed

## Decision

AIWrapper should make **speech activity detection** pluggable, but it should not
own the complete interruption workflow.

The consuming application should decide when speech counts as an interruption,
pause or stop playback, cancel the active turn, and record only what the user
heard. Those decisions depend on application playback state and conversation
policy.

The first complete implementation should be proven in a real voice application.
Once it has run end to end, AIWrapper can extract the proven detector contract
from the main `aiwrapper` package.

## Why interruption is layered

An interruption is not one detection event:

1. **Speech activity:** audio begins to look like human speech.
2. **Interruption candidate:** speech continues while assistant audio is active.
3. **Confirmation:** transcription or another classifier decides that this is a
   real attempt to take the turn, rather than noise, echo, or a backchannel such
   as "mhm."
4. **Action:** the application pauses or cancels LLM, tools, TTS, and playback.
5. **Accounting:** the application uses its playback cursor to preserve only
   fully heard speech in conversation history.

The detector supplies evidence for steps 1 and 2. It cannot honestly perform
steps 4 and 5 because it does not know what reached the user's ears.

## Application behavior

While assistant audio is active:

```text
microphone PCM
  -> speech activity detector
  -> sustained-speech threshold
  -> pause playback immediately
  -> transcribe the candidate
  -> confirm interruption or resume playback
```

On confirmation, the application aborts the shared turn signal, cancels active
TTS and tool work, discards queued audio, and writes history using the
heard-playback cursor. On a false interruption, it resumes from the paused
sample.

Transcript similarity with the assistant's current speech is useful for echo
rejection, but it is only a heuristic. Acoustic echo cancellation remains the
first defense, because transcription errors and overlapping speech prevent
text matching from proving the speaker with certainty.

## Proposed AIWrapper contract

The contract should follow the existing PCM and session conventions:

```ts
type SpeechActivityEvent =
  | { type: "speech-start"; sampleOffset: number; confidence?: number }
  | { type: "speech-end"; sampleOffset: number; confidence?: number };

type SpeechActivitySessionOptions = {
  signal?: AbortSignal;
  onActivity?: (event: SpeechActivityEvent) => void;
};

interface SpeechActivitySession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

interface SpeechActivityDetector {
  readonly inputFormat: Pick<PcmAudioFormat, "encoding" | "channels">;
  createSession(
    options?: SpeechActivitySessionOptions,
  ): Promise<SpeechActivitySession>;
}
```

`sampleOffset` makes detector output deterministic and lets an application map
events to its own audio clock. Implementations must declare accepted formats and
must not silently resample, matching the existing speech-provider rules.

Possible implementations include an energy threshold, WebRTC VAD, a local
neural VAD such as Silero, or a remote model. AIWrapper should not force one
runtime or model dependency into the base package.

A semantic `TurnClassifier` may be useful later, but it should be a separate
contract. VAD answers "is there speech?" while turn classification answers "does
the speaker intend to take the turn?" Combining them would make simple local
detectors unnecessarily dependent on transcription and product policy.

## Delivery order

1. Implement pause, confirm, resume, cancellation, and heard-history accounting
   in a consuming voice application with an internal detector.
2. Use deterministic audio fixtures to establish event timing and false
   interruption behavior.
3. Extract `SpeechActivityDetector` into AIWrapper's main package.
4. Ship a mock and one small reference implementation with the contract.
5. Add WebRTC, Silero, or provider adapters independently as demand proves them.
6. Consider `TurnClassifier` only after at least two classification strategies
   need the same application-facing contract.

## Non-goals

- Microphone capture, beamforming, and acoustic echo cancellation
- Playback queues, pause/resume, or a generated-audio-equals-heard assumption
- Conversation-history mutation or a high-level live-agent session
- Choosing universal interruption thresholds or backchannel words
- Speaker enrollment or target-speaker verification

## Tests

AIWrapper tests should cover deterministic speech start/end sample offsets,
silence and noise, reset, sample-rate changes, abort, close, and mock-controlled
events. Application integration tests should cover pause/resume on false
interruption, shared cancellation on confirmation, echo/backchannel rejection,
and history truncation against the playback cursor.

## References

- [AIWrapper speech-provider contract](../../speech.md)
- [LiveKit turn handling overview](https://docs.livekit.io/agents/logic/turns/)
- [LiveKit interruption tuning](https://docs.livekit.io/agents/logic/turns/tuning/)
- [LiveKit turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector/)
- [WebRTC voice activity detector source](https://webrtc.googlesource.com/src/webrtc/%2B/96e7ca96cf7f61d4fd79a1987dc533ab9620dd4b/modules/audio_processing/vad/voice_activity_detector.cc)
- [Silero VAD](https://github.com/snakers4/silero-vad)
