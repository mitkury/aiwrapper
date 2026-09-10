import {
  AmazonNovaSonicSpeechToSpeech,
  type AmazonNovaSonicSpeechToSpeechOptions,
} from "./amazon-nova-sonic-speech-to-speech.js";
import {
  AzureVoiceLiveSpeechToSpeech,
  type AzureVoiceLiveSpeechToSpeechOptions,
} from "./azure-voice-live-speech-to-speech.js";
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
import {
  XAIVoiceSpeechToSpeech,
  type XAIVoiceSpeechToSpeechOptions,
} from "./xai-voice-speech-to-speech.js";

/**
 * @deprecated Use LiveLang from aiwrapper for new code.
 */
export abstract class SpeechToSpeech {
  static amazonNovaSonic(
    options: AmazonNovaSonicSpeechToSpeechOptions = {},
  ): AmazonNovaSonicSpeechToSpeech {
    return new AmazonNovaSonicSpeechToSpeech(options);
  }

  static azureVoiceLive(
    options: AzureVoiceLiveSpeechToSpeechOptions,
  ): AzureVoiceLiveSpeechToSpeech {
    return new AzureVoiceLiveSpeechToSpeech(options);
  }

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

  static xaiVoice(
    options: XAIVoiceSpeechToSpeechOptions,
  ): XAIVoiceSpeechToSpeech {
    return new XAIVoiceSpeechToSpeech(options);
  }

  static mock(options: MockSpeechToSpeechOptions = {}): MockSpeechToSpeech {
    return new MockSpeechToSpeech(options);
  }
}
