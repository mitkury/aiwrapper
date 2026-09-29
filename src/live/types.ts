import type {
  PcmAudioFormat,
  PcmAudioFrame,
  TranscriptEvent,
} from "../speech/types.js";
import type { LangTool, LangToolWithHandler, ToolRequest } from "../lang/messages.js";
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
  | { type: "tool-calls-canceled"; callIds: string[] }
  | { type: "session-resumption"; resumable: boolean; handle?: string }
  | { type: "connection-expiring"; timeLeftMs?: number }
  | { type: "connection-closed"; code?: number; reason?: string; wasClean?: boolean }
  | { type: "error"; error: Error };

export type LiveToolDefinition = Pick<LangToolWithHandler, "name" | "description" | "parameters">;

export type LiveTextOptions = {
  role?: "user" | "assistant";
  /** False appends context without requesting a response. Defaults to true. */
  turnComplete?: boolean;
  /** Send as live user activity instead of conversation context (Gemini only). */
  realtime?: boolean;
};

export type LiveImageInput = {
  /** Base64 image bytes, without a data URL prefix. */
  data: string;
  mimeType: "image/jpeg" | "image/png";
};

export type SpeechToSpeechSessionOptions = {
  signal?: AbortSignal;
  instructions?: string;
  tools?: LangTool[];
  /** Manual mode emits calls without executing handlers. Currently supported by Gemini. */
  toolHandling?: "automatic" | "manual";
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
  /** End the microphone stream without closing the connection. Audio can resume later. */
  endAudio?(): Promise<void>;
  /** Optional capabilities: check before use when selecting a provider dynamically. */
  sendText?(text: string, options?: LiveTextOptions): Promise<void>;
  appendImage?(image: LiveImageInput): Promise<void>;
  /** Manual mode only. The application owns execution, ordering and replay. */
  sendToolResults?(results: LangToolExecutionResult[]): Promise<void>;
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
