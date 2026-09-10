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
import type {
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import {
  XAIVoiceSpeechToSpeech,
  type XAIVoiceSpeechToSpeechOptions,
} from "./xai-voice-speech-to-speech.js";

export type LiveLangConnectOptions = SpeechToSpeechSessionOptions;
export type LiveLangSession = SpeechToSpeechSession;
export type LiveLangProvider = SpeechToSpeechProvider;
export type OpenAILiveLangOptions = OpenAIRealtimeSpeechToSpeechOptions;
export type GoogleLiveLangOptions = GeminiLiveSpeechToSpeechOptions;
export type XAILiveLangOptions = XAIVoiceSpeechToSpeechOptions;
export type AzureLiveLangOptions = AzureVoiceLiveSpeechToSpeechOptions;
export type AWSLiveLangOptions = AmazonNovaSonicSpeechToSpeechOptions;
export type MockLiveLangOptions = MockSpeechToSpeechOptions;

/**
 * Factory and connection lifecycle for persistent, native multimodal models.
 */
export class LiveLang {
  static openai(options: OpenAILiveLangOptions): LiveLang {
    return new LiveLang(new OpenAIRealtimeSpeechToSpeech(options));
  }

  static google(options: GoogleLiveLangOptions): LiveLang {
    return new LiveLang(new GeminiLiveSpeechToSpeech(options));
  }

  static xai(options: XAILiveLangOptions): LiveLang {
    return new LiveLang(new XAIVoiceSpeechToSpeech(options));
  }

  static azure(options: AzureLiveLangOptions): LiveLang {
    return new LiveLang(new AzureVoiceLiveSpeechToSpeech(options));
  }

  static aws(options: AWSLiveLangOptions = {}): LiveLang {
    return new LiveLang(new AmazonNovaSonicSpeechToSpeech(options));
  }

  static mock(options: MockLiveLangOptions = {}): LiveLang {
    return new LiveLang(new MockSpeechToSpeech(options));
  }

  constructor(private readonly provider: LiveLangProvider) {}

  get inputFormat(): LiveLangProvider["inputFormat"] {
    return this.provider.inputFormat;
  }

  get outputFormat(): LiveLangProvider["outputFormat"] {
    return this.provider.outputFormat;
  }

  connect(options: LiveLangConnectOptions = {}): Promise<LiveLangSession> {
    return this.provider.createSession(options);
  }
}
