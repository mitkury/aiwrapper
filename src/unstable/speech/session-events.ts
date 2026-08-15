import type {
  SpeechToSpeechAnyEventListener,
  SpeechToSpeechEvent,
  SpeechToSpeechEventListener,
  SpeechToSpeechEventType,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";

type Listener = (event: SpeechToSpeechEvent) => void;
type ListenerType = SpeechToSpeechEventType | "event";
type SpeechToSpeechSessionTransport = Pick<
  SpeechToSpeechSession,
  "appendAudio" | "close"
>;

export async function createObservableSpeechToSpeechSession(
  options: SpeechToSpeechSessionOptions,
  createTransport: (
    options: SpeechToSpeechSessionOptions,
  ) => Promise<SpeechToSpeechSessionTransport>,
): Promise<SpeechToSpeechSession> {
  const listeners = new Map<ListenerType, Set<Listener>>();
  const dispatch = (event: SpeechToSpeechEvent): void => {
    callListener(options.onEvent, event);
    for (const listener of listeners.get("event") ?? []) {
      callListener(listener, event);
    }
    for (const listener of listeners.get(event.type) ?? []) {
      callListener(listener, event);
    }
  };
  const transport = await createTransport({ ...options, onEvent: dispatch });

  return {
    appendAudio: (frame) => transport.appendAudio(frame),
    async close() {
      try {
        await transport.close();
      } finally {
        listeners.clear();
      }
    },
    addEventListener(type: ListenerType, listener: Listener) {
      const group = listeners.get(type) ?? new Set<Listener>();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: ListenerType, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  } as SpeechToSpeechSession;
}

function callListener(
  listener:
    | SpeechToSpeechAnyEventListener
    | SpeechToSpeechEventListener
    | undefined,
  event: SpeechToSpeechEvent,
): void {
  if (!listener) return;
  try {
    (listener as SpeechToSpeechAnyEventListener)(event);
  } catch {
    // Observers must not terminate a provider stream or block other observers.
  }
}
