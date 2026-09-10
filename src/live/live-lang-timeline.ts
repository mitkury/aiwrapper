import type {
  SpeechToSpeechEvent,
  SpeechToSpeechSession,
} from "./types.js";

export type SpeechToSpeechTimelineStage =
  | "input-start"
  | "input-final"
  | "response-start"
  | "first-text"
  | "first-audio"
  | "tool-call"
  | "tool-result"
  | "response-end"
  | "response-interrupted"
  | "error";

export type SpeechToSpeechTimelineMilestone = {
  turnId: number;
  stage: SpeechToSpeechTimelineStage;
  milliseconds: number;
};

export type SpeechToSpeechTimeline = {
  record(
    event: SpeechToSpeechEvent,
    now?: number,
  ): SpeechToSpeechTimelineMilestone[];
  reset(): void;
};

type TurnTimeline = {
  id: number;
  startedAt: number;
  stages: Set<SpeechToSpeechTimelineStage>;
};

export function createSpeechToSpeechTimeline(): SpeechToSpeechTimeline {
  let nextTurnId = 1;
  let turn: TurnTimeline | undefined;

  return {
    record(event, now = performance.now()) {
      const stages = stagesForEvent(event);
      if (!stages.length) return [];

      turn ??= {
        id: nextTurnId++,
        startedAt: now,
        stages: new Set(),
      };
      const activeTurn = turn;
      const milestones = stages.flatMap((stage) => {
        if (activeTurn.stages.has(stage)) return [];
        activeTurn.stages.add(stage);
        return [
          {
            turnId: activeTurn.id,
            stage,
            milliseconds: Math.max(0, now - activeTurn.startedAt),
          },
        ];
      });

      if (
        event.type === "response-end" ||
        event.type === "response-interrupted"
      ) {
        turn = undefined;
      }
      return milestones;
    },
    reset() {
      nextTurnId = 1;
      turn = undefined;
    },
  };
}

export function observeSpeechToSpeechTimeline(
  session: SpeechToSpeechSession,
  listener: (milestone: SpeechToSpeechTimelineMilestone) => void,
): () => void {
  const timeline = createSpeechToSpeechTimeline();
  const onEvent = (event: SpeechToSpeechEvent): void => {
    for (const milestone of timeline.record(event)) listener(milestone);
  };
  session.addEventListener("event", onEvent);
  return () => session.removeEventListener("event", onEvent);
}

function stagesForEvent(
  event: SpeechToSpeechEvent,
): SpeechToSpeechTimelineStage[] {
  if (event.type === "input-transcript") {
    return event.transcript.type === "final"
      ? ["input-start", "input-final"]
      : ["input-start"];
  }
  if (event.type === "response-start") return ["response-start"];
  if (event.type === "output-transcript") return ["first-text"];
  if (event.type === "output-audio") return ["first-audio"];
  if (event.type === "tool-call") return ["tool-call"];
  if (event.type === "tool-result") return ["tool-result"];
  if (event.type === "response-end") return ["response-end"];
  if (event.type === "response-interrupted") {
    return ["response-interrupted"];
  }
  if (event.type === "error") return ["error"];
  return [];
}
