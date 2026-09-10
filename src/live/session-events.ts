import type {
  SpeechToSpeechAnyEventListener,
  SpeechToSpeechEvent,
  SpeechToSpeechEventListener,
  SpeechToSpeechEventType,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import { speechToSpeechFunctionDeclarations } from "./live-lang-tools.js";

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
  speechToSpeechFunctionDeclarations(options);
  const listeners = new Map<ListenerType, Set<Listener>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const dispatch = (event: SpeechToSpeechEvent): void => {
    const recipients = [
      options.onEvent,
      ...(listeners.get("event") ?? []),
      ...(listeners.get(event.type) ?? []),
    ];
    for (const listener of recipients) {
      if (closed || options.signal?.aborted) return;
      callListener(listener, event);
    }
  };
  const transport = await createTransport({ ...options, onEvent: dispatch });

  return {
    async appendAudio(frame) {
      if (closed) throw new Error("Speech-to-speech session is closed");
      await transport.appendAudio(frame);
    },
    async close() {
      if (!closed) {
        closed = true;
        listeners.clear();
        closing = transport.close();
      }
      await closing;
    },
    addEventListener(type: ListenerType, listener: Listener) {
      if (closed) return;
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
