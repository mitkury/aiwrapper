import type {
  PcmAudioFormat,
  PcmAudioFrame,
  TranscriptEvent,
} from "../speech/types.js";
import type { LangTool, LangToolWithHandler, ToolRequest } from "../lang/messages.js";
import type { LangToolExecutionResult } from "../lang/tool-execution.js";

/** Identifies one audio content part on the connection that emitted it. */
export type LiveAudioReference = { itemId: string; contentIndex: number };

export type SpeechToSpeechEvent =
  | { type: "output-audio"; frame: PcmAudioFrame; playback?: LiveAudioReference }
  | { type: "input-transcript"; transcript: TranscriptEvent }
  /** Transcription failed for one input item; the voice connection remains usable. */
  | { type: "input-transcript-failed"; id?: string; error: Error }
  /** source distinguishes generated text from the transcription of spoken audio. */
  | { type: "output-transcript"; transcript: TranscriptEvent; source?: "text" }
  | { type: "input-speech-start"; id?: string }
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
  /** Send as live user activity instead of silent conversation context. */
  realtime?: boolean;
};

export type LiveImageInput = {
  /** Base64 image bytes, without a data URL prefix. */
  data: string;
  mimeType: "image/jpeg" | "image/png";
};

/** A tool's result for a live session, with pictures the model should see as part of it (a map,
 *  a photo). Each provider delivers them where its protocol puts tool output: inside the function
 *  response where it can (Gemini Live), else as an image message right after the result. */
export type LiveToolResult = LangToolExecutionResult & { images?: LiveImageInput[] };

export type SpeechToSpeechSessionOptions = {
  signal?: AbortSignal;
  instructions?: string;
  tools?: LangTool[];
  /** Manual mode emits calls without executing handlers. Supported by Gemini and OpenAI Realtime. */
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
  /** Cancel the current response without requesting another one, when supported. */
  interrupt?(): Promise<void>;
  /** Trim unheard output on its original connection. playedMs is cumulative for this audio part, not this chunk. */
  truncateAudio?(position: LiveAudioReference & { playedMs: number }): Promise<void>;
  /** Manual mode only. The application owns execution, ordering and replay. */
  sendToolResults?(results: LiveToolResult[]): Promise<void>;
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
