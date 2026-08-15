import type {
  PcmAudioFormat,
  PcmAudioFrame,
  TranscriptEvent,
} from "../../speech/types.js";

export type SpeechToSpeechEvent =
  | { type: "output-audio"; frame: PcmAudioFrame }
  | { type: "input-transcript"; transcript: TranscriptEvent }
  | { type: "output-transcript"; transcript: TranscriptEvent }
  | { type: "response-start" }
  | { type: "response-end" }
  | { type: "response-interrupted" }
  | { type: "error"; error: Error };

export type SpeechToSpeechSessionOptions = {
  signal?: AbortSignal;
  instructions?: string;
  onEvent?: (event: SpeechToSpeechEvent) => void;
};

export interface SpeechToSpeechSession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  close(): Promise<void>;
}

export interface SpeechToSpeechProvider {
  readonly inputFormat: PcmAudioFormat;
  readonly outputFormat: PcmAudioFormat;

  createSession(
    options?: SpeechToSpeechSessionOptions,
  ): Promise<SpeechToSpeechSession>;
}
