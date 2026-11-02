import { afterEach, describe, expect, it } from "vitest";
import { Lang, Img, LiveLang, type UsageEvent } from "../../src/index.ts";
import { OpenAIChatCompletionsLang } from "../../src/lang/openai/openai-chat-completions-lang.ts";
import { OpenAISpeechToText, GoogleSpeechToText } from "../../src/speech/index.ts";
import { UsageReport, normalizeUsage } from "../../src/usage.ts";
import { setHttpRequestImpl } from "../../src/http-request.ts";

afterEach(() => setHttpRequestImpl());
const stream = (values: unknown[]) => new Response(values.map(v => `data: ${JSON.stringify(v)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

describe("usage subscriptions", () => {
  it("merges cumulative fields once and isolates synchronous/asynchronous observers", async () => {
    const events: UsageEvent[] = [];
    const report = new UsageReport(e => { events.push(e); }, "anthropic", "model");
    report.observe({ type: "message_start", message: { id: "m", model: "actual", usage: { input_tokens: 10, cache_read_input_tokens: 20 } } });
    report.observe({ type: "message_delta", usage: { output_tokens: 2 } });
    report.observe({ type: "message_delta", usage: { output_tokens: 7 } });
    report.finish(); report.finish();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "anthropic", model: "actual", requestId: "m", usage: { inputTokens: 30, cachedTokens: 20, outputTokens: 7 } });
    for (const handler of [() => { throw new Error("observer"); }, async () => { throw new Error("observer"); }]) {
      const report = new UsageReport(handler, "google", "model");
      report.observe({ usageMetadata: { promptTokenCount: 1 } });
      expect(() => report.finish()).not.toThrow();
    }
    await Promise.resolve();
  });
  it("does not invent counts and understands duration, cost and Nova deltas", () => {
    expect(normalizeUsage("openai", { input_tokens: -2, output_tokens: "3" })).toEqual({});
    expect(normalizeUsage("openai", { type: "duration", seconds: 2.5 })).toEqual({ audioSeconds: 2.5 });
    expect(normalizeUsage("openrouter", { prompt_tokens: 4, completion_tokens: 2, cost: 0.003 })).toEqual({ inputTokens: 4, outputTokens: 2, costUsd: 0.003 });
    expect(normalizeUsage("amazon", { totalTokens: 900, details: { delta: { input: { speechTokens: 3, textTokens: 1 }, output: { speechTokens: 2 } } } })).toEqual({ inputTokens: 4, outputTokens: 2, inputAudioTokens: 3, outputAudioTokens: 2 });
  });
  it("reports OpenRouter identity, terminal usage chunks and raw billed costs", async () => {
    const events: UsageEvent[] = [];
    let body: any;
    setHttpRequestImpl(async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return stream([
        { id: "gen", model: "actual", choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.002, is_byok: true } },
      ]);
    });
    await Lang.openrouter({ apiKey: "key", onUsage: e => { events.push(e); } }).ask("hi");
    expect(body.stream_options.include_usage).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "openrouter", model: "actual", usage: { costUsd: 0.002 }, rawUsage: { is_byok: true } });
  });
  it("supports direct compatible instances and per-call callbacks", async () => {
    const events: UsageEvent[] = [];
    setHttpRequestImpl(async () => stream([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1 } }]));
    await OpenAIChatCompletionsLang.custom({ model: "model", baseURL: "https://example.invalid", onUsage: e => { events.push(e); } }).ask("hi");
    expect(events[0].provider).toBe("openai-compatible");
  });
  it("captures reports before transcript and image response validation", async () => {
    const events: UsageEvent[] = [];
    const onUsage = (e: UsageEvent) => { events.push(e); };
    setHttpRequestImpl(async () => new Response(JSON.stringify({ usage: { type: "duration", seconds: 3 } })));
    const session = await new OpenAISpeechToText({ apiKey: "key", onUsage }).createSession();
    await session.appendAudio({ encoding: "pcm_s16le", channels: 1, sampleRate: 24000, samples: new Int16Array([1]) });
    await expect(session.finish()).rejects.toThrow();
    setHttpRequestImpl(async () => new Response(JSON.stringify({ usageMetadata: { promptTokenCount: 4 } })));
    await expect(new GoogleSpeechToText({ apiKey: "key", onUsage }).transcribe(new Blob(["audio"], { type: "audio/webm" }))).rejects.toThrow();
    setHttpRequestImpl(async () => new Response(JSON.stringify({ usage: { input_tokens: 5 } })));
    await expect(Img.openai({ apiKey: "key", onUsage }).generate("a" )).rejects.toThrow();
    expect(events.map(e => e.operation)).toEqual(["transcription", "transcription", "image"]);
  });
  it("captures usage after text output fails and keeps provider instances isolated", async () => {
    const events: UsageEvent[] = [];
    setHttpRequestImpl(async () => new Response(JSON.stringify({ candidates: [], usageMetadata: { promptTokenCount: 9 } })));
    await Lang.google({ apiKey: "key", onUsage: e => { events.push(e); } }).ask("hi");
    await Lang.google({ apiKey: "key" }).ask("hi");
    expect(events).toHaveLength(1);
  });
});

it("reports provider-billed synthesis character units from response headers", async () => {
  const { ElevenLabsTextToSpeech } = await import("../../src/speech/index.ts");
  const reports: UsageEvent[] = [];
  setHttpRequestImpl(async () => new Response(new Uint8Array([1, 0]), { headers: { "character-cost": "3", "request-id": "tts-1" } }));
  const provider = new ElevenLabsTextToSpeech({ apiKey: "key", voiceId: "voice", onUsage: event => { reports.push(event); } });
  for await (const _frame of provider.speak("hello")) { /* Drain the provider stream. */ }
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ provider: "elevenlabs", operation: "speech-synthesis", requestId: "tts-1", usage: { characters: 3 }, rawUsage: { characterCost: 3 } });
});
