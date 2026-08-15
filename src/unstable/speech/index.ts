import {
  GeminiLiveSpeechToSpeech,
  type GeminiLiveSpeechToSpeechOptions,
} from "./gemini-live-speech-to-speech.js";
import {
  MockSpeechToSpeech,
  type MockSpeechToSpeechOptions,
} from "./mock-speech-to-speech.js";
import {
  OpenAIRealtimeSpeechToSpeech,
  type OpenAIRealtimeSpeechToSpeechOptions,
} from "./openai-realtime-speech-to-speech.js";

export abstract class SpeechToSpeech {
  static openaiRealtime(
    options: OpenAIRealtimeSpeechToSpeechOptions,
  ): OpenAIRealtimeSpeechToSpeech {
    return new OpenAIRealtimeSpeechToSpeech(options);
  }

  static geminiLive(
    options: GeminiLiveSpeechToSpeechOptions,
  ): GeminiLiveSpeechToSpeech {
    return new GeminiLiveSpeechToSpeech(options);
  }

  static mock(options: MockSpeechToSpeechOptions = {}): MockSpeechToSpeech {
    return new MockSpeechToSpeech(options);
  }
}

export * from "../../speech/index.js";
export * from "./types.js";
export * from "./mock-speech-to-speech.js";
export * from "./openai-realtime-speech-to-speech.js";
export * from "./gemini-live-speech-to-speech.js";
