import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LiveLang, type LiveLangEvent, type LiveLangSession, type LiveAudioReference, type RealtimeSpeechWebSocket } from "../../src/index.ts";

const apiKey = process.env.OPENAI_API_KEY;
const providers = (process.env.PROVIDERS ?? "").split(",").filter(Boolean);
const live = () => LiveLang.openai({ apiKey: apiKey!, model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1" });

describe.skipIf(!apiKey || (providers.length > 0 && !providers.includes("openai")))("OpenAI Realtime application integration", () => {
  it("transcribes streamed speech and returns audible PCM on two turns", async () => {
    const bytes = await readFile(new URL("./fixtures/hello.pcm", import.meta.url));
    const source = Int16Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2));
    // The checked-in fixture is 16 kHz. Resampling is an application concern.
    const samples = Int16Array.from({ length: Math.floor(source.length * 1.5) }, (_, i) => {
      const position = i / 1.5, left = Math.floor(position), fraction = position - left;
      return Math.round(source[left] * (1 - fraction) + source[Math.min(left + 1, source.length - 1)] * fraction);
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("OpenAI voice test timed out")), 60_000);
    let session: LiveLangSession | undefined;
    let observe = (_event: LiveLangEvent): void => {};
    try {
      session = await live().connect({
        signal: controller.signal,
        instructions: "Wait for the user to speak. Answer aloud with one short sentence.",
        onEvent(event) { if (event.type === "error") controller.abort(event.error); observe(event); },
      });
      for (let index = 1; index <= 2; index++) {
        let input = "", output = "", count = 0, peak = 0, ended = false;
        let resolve!: () => void, reject!: (reason: unknown) => void;
        const turn = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        void turn.catch(() => {});
        const aborted = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", aborted, { once: true });
        observe = event => {
          if (event.type === "input-transcript") input += event.transcript.text;
          if (event.type === "output-transcript") output += event.transcript.text;
          if (event.type === "output-audio") {
            expect(event.frame.sampleRate).toBe(24000);
            expect(event.frame.channels).toBe(1);
            count += event.frame.samples.length;
            for (const sample of event.frame.samples) peak = Math.max(peak, Math.abs(sample));
          }
          if (event.type === "response-end") ended = true;
          if (input.trim() && output.trim() && count >= 2400 && peak > 128 && ended) resolve();
        };
        try {
          controller.signal.throwIfAborted();
          for (let offset = 0; offset < samples.length; offset += 480) {
            await session.appendAudio({ encoding: "pcm_s16le", channels: 1, sampleRate: 24000, samples: samples.subarray(offset, offset + 480) });
            await delay(20, undefined, { signal: controller.signal });
          }
          await turn;
          console.info(`OpenAI voice turn ${index}: ${JSON.stringify({ inputCharacters: input.length, outputCharacters: output.length, audioMs: Math.round(count / 24), peak })}`);
        } finally { controller.signal.removeEventListener("abort", aborted); observe = () => {}; }
      }
    } finally { clearTimeout(timer); await session?.close(); }
  }, 65_000);

  it("acknowledges audio truncation and speaks again after Stop", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("OpenAI playback test timed out")), 30_000);
    let session: LiveLangSession | undefined;
    let reference: LiveAudioReference | undefined;
    let truncated: { item_id: string; content_index: number; audio_end_ms: number } | undefined;
    let nextTurn = false, ended = false, nextSamples = 0;
    const waitFor = async (ready: () => boolean) => {
      controller.signal.throwIfAborted();
      while (!ready()) await delay(20, undefined, { signal: controller.signal });
    };
    try {
      session = await LiveLang.openai({
        apiKey: apiKey!, model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1",
        createWebSocket(url, headers) {
          const socket = new WebSocket(url, { headers });
          // Observe the provider acknowledgement without expanding the public event API.
          socket.on("message", data => {
            const event = JSON.parse(data.toString());
            if (event.type === "conversation.item.truncated") truncated = event;
          });
          return socket as unknown as RealtimeSpeechWebSocket;
        },
      }).connect({
        signal: controller.signal, instructions: "Speak aloud and follow the user's request.",
        onEvent(event) {
          if (event.type === "error") controller.abort(event.error);
          if (event.type === "output-audio") {
            reference ??= event.playback;
            if (nextTurn) nextSamples += event.frame.samples.length;
          }
          if (nextTurn && event.type === "response-start") ended = false;
          if (nextTurn && event.type === "response-end") ended = true;
        },
      });
      await session.sendText!("Count aloud from one to twenty.");
      await waitFor(() => Boolean(reference));
      await session.interrupt!();
      await session.truncateAudio!({ ...reference!, playedMs: 0 });
      await waitFor(() => Boolean(truncated));
      expect(truncated).toMatchObject({ item_id: reference!.itemId, content_index: reference!.contentIndex, audio_end_ms: 0 });
      nextTurn = true;
      await session.sendText!("Say ready.");
      await waitFor(() => nextSamples > 2400 && ended);
    } finally { clearTimeout(timer); await session?.close(); }
  }, 35_000);

  it("accepts silent context, an image and manual tool results, then speaks", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("OpenAI tool test timed out")), 30_000);
    let session: LiveLangSession | undefined;
    let calls = 0, audioSamples = 0;
    let resolve!: () => void, reject!: (reason: unknown) => void;
    const turn = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void turn.catch(() => {});
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    try {
      session = await live().connect({
        signal: controller.signal, toolHandling: "manual",
        instructions: "Always call lookup_marker before answering. Speak one short sentence with its result.",
        tools: [{ name: "lookup_marker", description: "Read a test marker", parameters: { type: "object", properties: {} } }],
        onEvent(event) {
          if (event.type === "error") reject(event.error);
          if (event.type === "output-audio") audioSamples += event.frame.samples.length;
          if (event.type === "tool-call") {
            calls++;
            void session!.sendToolResults!([{ ...event.call, result: { marker: "ready" } }]).catch(reject);
          }
          if (event.type === "response-end" && calls && audioSamples) resolve();
        },
      });
      await session.sendText!("This is a connection test.", { turnComplete: false });
      await session.appendImage!({ mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwBfJiEYzmiH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBtLkBWsQ0Z18AAAAASUVORK5CYII=" });
      await session.sendText!("Look up the test marker and say it.");
      await turn;
      expect(calls).toBeGreaterThan(0);
      expect(audioSamples).toBeGreaterThan(2400);
    } finally { clearTimeout(timer); await session?.close(); }
  }, 35_000);
});
