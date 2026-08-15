import { describe, expect, it, vi } from "vitest";
import {
  createSpeechToSpeechTimeline,
  observeSpeechToSpeechTimeline,
  type SpeechToSpeechEvent,
  type SpeechToSpeechSession,
} from "../../src/unstable/speech/index.ts";

describe("speech-to-speech timeline", () => {
  it("records each useful milestone once and starts a new turn", () => {
    const timeline = createSpeechToSpeechTimeline();
    const milestones = [
      ...timeline.record(inputTranscript("delta", "hel"), 100),
      ...timeline.record(inputTranscript("final", "hello"), 140),
      ...timeline.record({ type: "response-start" }, 200),
      ...timeline.record(outputTranscript("delta", "hi"), 230),
      ...timeline.record(outputAudio(), 250),
      ...timeline.record({ type: "response-end" }, 300),
    ];

    expect(milestones).toEqual([
      { turnId: 1, stage: "input-start", milliseconds: 0 },
      { turnId: 1, stage: "input-final", milliseconds: 40 },
      { turnId: 1, stage: "response-start", milliseconds: 100 },
      { turnId: 1, stage: "first-text", milliseconds: 130 },
      { turnId: 1, stage: "first-audio", milliseconds: 150 },
      { turnId: 1, stage: "response-end", milliseconds: 200 },
    ]);
    expect(timeline.record({ type: "response-start" }, 400)).toEqual([
      { turnId: 2, stage: "response-start", milliseconds: 0 },
    ]);
  });

  it("subscribes to a session and returns an unsubscribe function", () => {
    const listeners = new Set<(event: SpeechToSpeechEvent) => void>();
    const session = {
      addEventListener(type: string, listener: (event: SpeechToSpeechEvent) => void) {
        if (type === "event") listeners.add(listener);
      },
      removeEventListener(type: string, listener: (event: SpeechToSpeechEvent) => void) {
        if (type === "event") listeners.delete(listener);
      },
    } as SpeechToSpeechSession;
    const onMilestone = vi.fn();
    const unsubscribe = observeSpeechToSpeechTimeline(session, onMilestone);

    for (const listener of listeners) listener({ type: "response-start" });
    expect(onMilestone).toHaveBeenCalledWith({
      turnId: 1,
      stage: "response-start",
      milliseconds: 0,
    });

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });
});

function inputTranscript(
  type: "delta" | "final",
  text: string,
): SpeechToSpeechEvent {
  return { type: "input-transcript", transcript: { type, text } };
}

function outputTranscript(
  type: "delta" | "final",
  text: string,
): SpeechToSpeechEvent {
  return { type: "output-transcript", transcript: { type, text } };
}

function outputAudio(): SpeechToSpeechEvent {
  return {
    type: "output-audio",
    frame: {
      encoding: "pcm_s16le",
      channels: 1,
      sampleRate: 24_000,
      samples: new Int16Array([1]),
    },
  };
}
