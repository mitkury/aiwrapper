import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LiveLang, type LiveLangEvent, type LiveLangSession, type PcmAudioFrame } from "../../src/index.ts";

const providers = (process.env.PROVIDERS ?? "").split(",").filter(Boolean);
const apiKey = process.env.GOOGLE_API_KEY;

describe.skipIf(!apiKey || (providers.length > 0 && !providers.includes("google")))(
  "Gemini Live application integration",
  () => {
    it("transcribes streamed speech and replies with audio on two consecutive turns", async () => {
      const bytes = await readFile(new URL("./fixtures/hello.pcm", import.meta.url));
      expect(bytes.length % 2).toBe(0);
      expect(bytes.length).toBeGreaterThan(16_000 * 2);
      const samples = Int16Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readInt16LE(index * 2));
      expect(samples.some(sample => Math.abs(sample) > 128)).toBe(true);

      const controller = new AbortController();
      let session: LiveLangSession | undefined;
      let onTurnEvent = (_event: LiveLangEvent): void => {};
      try {
        session = await LiveLang.google({
          apiKey: apiKey!, model: process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live",
          config: {
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                prefixPaddingMs: 300,
                silenceDurationMs: 500,
              },
            },
          },
        }).connect({
          signal: controller.signal,
          instructions: "Listen to the user and reply aloud with one short sentence. Wait for the user to speak first.",
          onEvent(event) {
            if (event.type === "error") controller.abort(event.error);
            onTurnEvent(event);
          },
        });
        expect(session.endAudio).toBeTypeOf("function");

        for (let index = 1; index <= 2; index++) {
          controller.signal.throwIfAborted();
          const frames: PcmAudioFrame[] = [];
          let inputTranscript = "";
          let outputTranscript = "";
          let ended = false;
          let resolveTurn!: () => void;
          let rejectTurn!: (error: unknown) => void;
          const turn = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
          // A provider error can arrive while the fixture is still streaming.
          void turn.catch(() => {});
          const onAbort = () => rejectTurn(controller.signal.reason);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          const timer = setTimeout(() => controller.abort(new Error(
            `Voice turn ${index} timed out: ${JSON.stringify({
              inputCharacters: inputTranscript.trim().length,
              outputCharacters: outputTranscript.trim().length,
              audioFrames: frames.length, ended,
            })}`,
          )), 30_000);
          onTurnEvent = event => {
            if (event.type === "input-transcript") inputTranscript += event.transcript.text;
            if (event.type === "output-transcript" && event.source !== "text") outputTranscript += event.transcript.text;
            if (event.type === "output-audio") frames.push(event.frame);
            if (event.type === "response-end") ended = true;
            // Transcript events can arrive after the audio/turn marker.
            if (ended && inputTranscript.trim() && outputTranscript.trim() && frames.length) resolveTurn();
          };
          try {
            // Simulate a microphone: 20 ms of 16 kHz mono PCM per packet.
            // The fixture includes leading/trailing silence for automatic VAD.
            for (let offset = 0; offset < samples.length; offset += 320) {
              const chunk = samples.subarray(offset, offset + 320);
              await session.appendAudio({ samples: chunk, sampleRate: 16_000, channels: 1, encoding: "pcm_s16le" });
              await delay(chunk.length / 16, undefined, { signal: controller.signal });
            }
            await session.endAudio!();
            await turn;
            let outputSamples = 0;
            let peak = 0;
            for (const frame of frames) {
              expect(frame.sampleRate).toBe(24_000);
              expect(frame.channels).toBe(1);
              expect(frame.encoding).toBe("pcm_s16le");
              expect(frame.samples).toBeInstanceOf(Int16Array);
              outputSamples += frame.samples.length;
              for (const sample of frame.samples) peak = Math.max(peak, Math.abs(sample));
            }
            expect(outputSamples).toBeGreaterThanOrEqual(2_400);
            expect(peak).toBeGreaterThan(128);
            console.info(`Gemini voice turn ${index}: ${JSON.stringify({
              inputCharacters: inputTranscript.trim().length,
              outputCharacters: outputTranscript.trim().length,
              audioMs: Math.round(outputSamples / 24), peak,
            })}`);
          } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", onAbort);
            onTurnEvent = () => {};
          }
        }
      } catch (error) {
        throw controller.signal.aborted ? controller.signal.reason : error;
      } finally {
        await session?.close();
      }
    }, 75_000);

    it("accepts custom setup, image/context input and an application-owned tool result", async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let session: LiveLangSession | undefined;
      let sampleCount = 0;
      let toolCalls = 0;
      let resolveTurn!: () => void;
      let rejectTurn!: (error: unknown) => void;
      const turn = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
      void turn.catch(() => {});
      controller.signal.addEventListener("abort", () => rejectTurn(new Error("Live smoke test timed out")), { once: true });
      try {
        session = await LiveLang.google({
          apiKey: apiKey!, model: process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live",
          config: {
            sessionResumption: {}, contextWindowCompression: { slidingWindow: {} },
            mediaResolution: "MEDIA_RESOLUTION_LOW", toolBehavior: "BLOCKING",
            realtimeInputConfig: {
              automaticActivityDetection: { disabled: false },
              activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
              turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
            },
          },
        }).connect({
          signal: controller.signal, toolHandling: "manual",
          instructions: "Always call lookup_marker before answering. Speak one short sentence with its result.",
          tools: [{ name: "lookup_marker", description: "Read the test marker", parameters: { type: "object", properties: {} } }],
          onEvent(event) {
            if (event.type === "error") rejectTurn(event.error);
            if (event.type === "output-audio") sampleCount += event.frame.samples.length;
            if (event.type === "tool-call") {
              toolCalls++;
              void session!.sendToolResults!([{ ...event.call, result: { marker: "ready" } }]).catch(rejectTurn);
            }
            if (event.type === "response-end" && toolCalls > 0 && sampleCount > 0) resolveTurn();
          },
        });
        await session.sendText!("This is a connection test.", { turnComplete: false });
        // Synthetic one-pixel PNG, never a user's camera or private file.
        await session.appendImage!({
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=",
        });
        await session.sendText!("Look up the test marker and say it.");
        await turn;
        expect(toolCalls).toBeGreaterThan(0);
        expect(sampleCount).toBeGreaterThan(0);
      } finally {
        clearTimeout(timer);
        await session?.close();
      }
    }, 35_000);
  },
);
