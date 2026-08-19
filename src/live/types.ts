import type {
  PcmAudioFormat,
  PcmAudioFrame,
  TranscriptEvent,
} from "../speech/types.js";
import type { LangTool, ToolRequest } from "../lang/messages.js";
import type { LangToolExecutionResult } from "../lang/tool-execution.js";

export type SpeechToSpeechEvent =
  | { type: "output-audio"; frame: PcmAudioFrame }
  | { type: "input-transcript"; transcript: TranscriptEvent }
  | { type: "output-transcript"; transcript: TranscriptEvent }
  | { type: "response-start" }
  | { type: "response-end" }
  | { type: "response-interrupted" }
  | { type: "tool-call"; call: ToolRequest }
  | { type: "tool-result"; result: LangToolExecutionResult }
  | { type: "error"; error: Error };

export type SpeechToSpeechSessionOptions = {
  signal?: AbortSignal;
  instructions?: string;
  tools?: LangTool[];
  onEvent?: (event: SpeechToSpeechEvent) => void;
};

export type SpeechToSpeechEventType = SpeechToSpeechEvent["type"];

export type SpeechToSpeechEventListener<
  Type extends SpeechToSpeechEventType = SpeechToSpeechEventType,
> = (event: Extract<SpeechToSpeechEvent, { type: Type }>) => void;

export type SpeechToSpeechAnyEventListener = (
  event: SpeechToSpeechEvent,
) => void;

export interface SpeechToSpeechSession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  close(): Promise<void>;
  addEventListener(
    type: "event",
    listener: SpeechToSpeechAnyEventListener,
  ): void;
  addEventListener<Type extends SpeechToSpeechEventType>(
    type: Type,
    listener: SpeechToSpeechEventListener<Type>,
  ): void;
  removeEventListener(
    type: "event",
    listener: SpeechToSpeechAnyEventListener,
  ): void;
  removeEventListener<Type extends SpeechToSpeechEventType>(
    type: Type,
    listener: SpeechToSpeechEventListener<Type>,
  ): void;
}

export interface SpeechToSpeechProvider {
  readonly inputFormat: PcmAudioFormat;
  readonly outputFormat: PcmAudioFormat;

  createSession(
    options?: SpeechToSpeechSessionOptions,
  ): Promise<SpeechToSpeechSession>;
}
