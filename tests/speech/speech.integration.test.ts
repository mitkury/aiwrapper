import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ElevenLabsTextToSpeech,
  GoogleSpeechToText,
  OpenAIRealtimeSpeechToText,
  OpenAISpeechToText,
  OpenAITextToSpeech,
  type PcmAudioFrame,
} from "../../src/speech/index.ts";

const selectedProviders = new Set(
  (process.env.PROVIDERS ?? "")
    .split(",")
    .map(provider => provider.trim().toLowerCase())
    .filter(Boolean),
);
const providerSelected = (provider: string): boolean =>
  selectedProviders.size === 0 || selectedProviders.has(provider);

const openAIKey = process.env.OPENAI_API_KEY;
const googleKey = process.env.GOOGLE_API_KEY;
const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;

describe.skipIf(!openAIKey || !providerSelected("openai"))(
  "OpenAI speech integration",
  () => {
    it("synthesizes speech and transcribes it back", async () => {
      const tts = new OpenAITextToSpeech({ apiKey: openAIKey! });
      const frames: PcmAudioFrame[] = [];

      for await (const frame of tts.speak("AI wrapper speech test.")) {
        frames.push(frame);
      }

      expect(frames.length).toBeGreaterThan(0);
      expect(frames.reduce((total, frame) => total + frame.samples.length, 0))
        .toBeGreaterThan(tts.outputFormat.sampleRate / 4);

      const stt = new OpenAISpeechToText({ apiKey: openAIKey! });
      const session = await stt.createSession();
      try {
        for (const frame of frames) await session.appendAudio(frame);
        const result = await session.finish();
        expect(result.text.toLowerCase()).toContain("speech test");
      } finally {
        await session.close();
      }
    });

    it("streams a realtime transcript over one committed turn", async () => {
      const tts = new OpenAITextToSpeech({ apiKey: openAIKey! });
      const stt = new OpenAIRealtimeSpeechToText({ apiKey: openAIKey! });
      const transcriptEvents: string[] = [];
      const session = await stt.createSession({
        onTranscript: event => transcriptEvents.push(event.type),
      });

      try {
        for await (const frame of tts.speak("AI wrapper realtime speech test.")) {
          await session.appendAudio(frame);
        }
        const result = await session.commit();
        expect(result.text.toLowerCase()).toContain("speech test");
        expect(transcriptEvents).toContain("final");
      } finally {
        await session.close();
      }
    });
  },
);

describe.skipIf(
  !elevenLabsKey ||
    !elevenLabsVoiceId ||
    !providerSelected("elevenlabs"),
)("ElevenLabs speech integration", () => {
  it("streams non-empty PCM audio", async () => {
    const tts = new ElevenLabsTextToSpeech({
      apiKey: elevenLabsKey!,
      voiceId: elevenLabsVoiceId!,
      sampleRate: 24000,
    });
    let frameCount = 0;
    let sampleCount = 0;
    let hasSignal = false;

    for await (const frame of tts.speak("AI wrapper speech test.")) {
      frameCount++;
      sampleCount += frame.samples.length;
      hasSignal ||= frame.samples.some(sample => sample !== 0);
    }

    expect(frameCount).toBeGreaterThan(0);
    expect(sampleCount).toBeGreaterThan(tts.outputFormat.sampleRate / 4);
    expect(hasSignal).toBe(true);
  });
});

describe.skipIf(!googleKey || !providerSelected("google"))(
  "Google speech integration",
  () => {
    it("transcribes the hello fixture", async () => {
      const bytes = await readFile(new URL("./fixtures/hello.pcm", import.meta.url));
      const samples = Int16Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readInt16LE(index * 2));
      const session = await new GoogleSpeechToText({ apiKey: googleKey! }).createSession();
      try {
        await session.appendAudio({ encoding: "pcm_s16le", channels: 1, sampleRate: 16000, samples });
        const result = await session.finish();
        expect(result.text.toLowerCase()).toContain("hello");
      } finally {
        await session.close();
      }
    });
  },
);
