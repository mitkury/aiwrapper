export {
  LiveLang,
  type AWSLiveLangOptions,
  type AzureLiveLangOptions,
  type GoogleLiveLangOptions,
  type LiveLangConnectOptions,
  type LiveLangProvider,
  type LiveLangSession,
  type MockLiveLangOptions,
  type OpenAILiveLangOptions,
  type XAILiveLangOptions,
} from "./live-lang.js";

export type {
  SpeechToSpeechAnyEventListener as LiveLangAnyEventListener,
  SpeechToSpeechEvent as LiveLangEvent,
  SpeechToSpeechEventListener as LiveLangEventListener,
  SpeechToSpeechEventType as LiveLangEventType,
} from "./types.js";

export {
  createSpeechToSpeechTimeline as createLiveLangTimeline,
  observeSpeechToSpeechTimeline as observeLiveLangTimeline,
} from "./live-lang-timeline.js";
export type {
  SpeechToSpeechTimeline as LiveLangTimeline,
  SpeechToSpeechTimelineMilestone as LiveLangTimelineMilestone,
  SpeechToSpeechTimelineStage as LiveLangTimelineStage,
} from "./live-lang-timeline.js";

export { SpeechToSpeech } from "./speech-to-speech.js";
export * from "./types.js";
export * from "./mock-speech-to-speech.js";
export * from "./openai-realtime-speech-to-speech.js";
export * from "./gemini-live-speech-to-speech.js";
export * from "./xai-voice-speech-to-speech.js";
export * from "./azure-voice-live-speech-to-speech.js";
export * from "./amazon-nova-sonic-speech-to-speech.js";
export * from "./live-lang-timeline.js";
