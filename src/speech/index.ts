import {
  OpenAISpeechToText,
  type OpenAISpeechToTextOptions,
} from "./openai-speech-to-text.js";
import {
  OpenAITextToSpeech,
  type OpenAITextToSpeechOptions,
} from "./openai-text-to-speech.js";
import {
  OpenAIRealtimeSpeechToText,
  type OpenAIRealtimeSpeechToTextOptions,
} from "./openai-realtime-speech-to-text.js";
import {
  ElevenLabsTextToSpeech,
  type ElevenLabsTextToSpeechOptions,
} from "./elevenlabs-text-to-speech.js";
import {
  DeepgramFluxSpeechToText,
  type DeepgramFluxSpeechToTextOptions,
} from "./deepgram-flux-speech-to-text.js";
import {
  ElevenLabsRealtimeSpeechToText,
  type ElevenLabsRealtimeSpeechToTextOptions,
} from "./elevenlabs-realtime-speech-to-text.js";
import {
  MockSpeechToText,
  MockTextToSpeech,
  type MockSpeechToTextOptions,
  type MockTextToSpeechOptions,
} from "./mock.js";

export abstract class SpeechToText {
  static openai(options: OpenAISpeechToTextOptions): OpenAISpeechToText {
    return new OpenAISpeechToText(options);
  }

  static openaiRealtime(
    options: OpenAIRealtimeSpeechToTextOptions,
  ): OpenAIRealtimeSpeechToText {
    return new OpenAIRealtimeSpeechToText(options);
  }

  static deepgramFlux(
    options: DeepgramFluxSpeechToTextOptions,
  ): DeepgramFluxSpeechToText {
    return new DeepgramFluxSpeechToText(options);
  }

  static elevenlabsRealtime(
    options: ElevenLabsRealtimeSpeechToTextOptions,
  ): ElevenLabsRealtimeSpeechToText {
    return new ElevenLabsRealtimeSpeechToText(options);
  }

  static mock(options: MockSpeechToTextOptions = {}): MockSpeechToText {
    return new MockSpeechToText(options);
  }
}

export abstract class TextToSpeech {
  static openai(options: OpenAITextToSpeechOptions): OpenAITextToSpeech {
    return new OpenAITextToSpeech(options);
  }

  static elevenlabs(
    options: ElevenLabsTextToSpeechOptions,
  ): ElevenLabsTextToSpeech {
    return new ElevenLabsTextToSpeech(options);
  }

  static mock(options: MockTextToSpeechOptions = {}): MockTextToSpeech {
    return new MockTextToSpeech(options);
  }
}

export * from "./types.js";
export * from "./realtime-websocket.js";
export * from "./openai-speech-to-text.js";
export * from "./openai-realtime-speech-to-text.js";
export * from "./deepgram-flux-speech-to-text.js";
export * from "./elevenlabs-realtime-speech-to-text.js";
export * from "./openai-text-to-speech.js";
export * from "./elevenlabs-text-to-speech.js";
export * from "./mock.js";
