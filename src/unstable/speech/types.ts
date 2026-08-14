export type PcmAudioFormat = {
  readonly encoding: "pcm_s16le";
  readonly sampleRate: number;
  readonly channels: 1;
};

export type PcmAudioFrame = PcmAudioFormat & {
  samples: Int16Array;
  timestampMs?: number;
};

export type TranscriptEvent =
  | { type: "delta"; text: string }
  | { type: "final"; text: string; languages?: string[] };

export type SpeechActivityEvent = {
  type: "start" | "end";
  audioOffsetMs?: number;
};

export type TranscriptionResult = {
  text: string;
  languages?: string[];
};

export type SpeechToTextSessionOptions = {
  signal?: AbortSignal;
  onTranscript?: (event: TranscriptEvent) => void;
  onSpeechActivity?: (event: SpeechActivityEvent) => void;
};

export interface SpeechToTextSession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  commit(): Promise<TranscriptionResult>;
  finish(): Promise<TranscriptionResult>;
  close(): Promise<void>;
}

export interface SpeechToTextProvider {
  readonly inputFormat: Pick<PcmAudioFormat, "encoding" | "channels"> &
    Partial<Pick<PcmAudioFormat, "sampleRate">>;
  createSession(
    options?: SpeechToTextSessionOptions,
  ): Promise<SpeechToTextSession>;
}

export type TextToSpeechOptions = {
  signal?: AbortSignal;
  voice?: string;
};

export interface TextToSpeechProvider {
  readonly outputFormat: PcmAudioFormat;
  speak(
    text: string,
    options?: TextToSpeechOptions,
  ): AsyncIterable<PcmAudioFrame>;
}
