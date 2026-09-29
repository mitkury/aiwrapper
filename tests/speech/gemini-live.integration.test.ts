import { describe, expect, it } from "vitest";
import { LiveLang, type LiveLangSession } from "../../src/index.ts";

const providers = (process.env.PROVIDERS ?? "").split(",").filter(Boolean);
const apiKey = process.env.GOOGLE_API_KEY;

describe.skipIf(!apiKey || (providers.length > 0 && !providers.includes("google")))(
  "Gemini Live application integration",
  () => {
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
