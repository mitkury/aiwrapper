import { describe, expect, it } from "vitest";
import { processServerEvents } from "../../src/process-server-events.ts";

function chunkedResponse(chunks: string[], contentType: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": contentType },
  });
}

describe("processServerEvents", () => {
  it("preserves SSE event names across network chunks", async () => {
    const seen: unknown[] = [];
    const response = chunkedResponse([
      "event: content-",
      "delta\r\n",
      "data:{\"text\":\"Hello\"}\r\n",
      "data: [DONE]\r\n",
    ], "text/event-stream");

    await processServerEvents(response, data => seen.push(data));

    expect(seen).toEqual([
      { type: "content-delta", text: "Hello" },
      { finished: true },
    ]);
  });

  it("parses NDJSON split across network chunks", async () => {
    const seen: unknown[] = [];
    const response = chunkedResponse([
      '{"index":',
      '1}\n{"index":2',
      '}\n',
    ], "application/x-ndjson");

    await processServerEvents(response, data => seen.push(data));

    expect(seen).toEqual([{ index: 1 }, { index: 2 }]);
  });

  it("ignores SSE comments and blank lines", async () => {
    const seen: unknown[] = [];
    const response = chunkedResponse([
      ': keepalive\n\nid: 12\nretry: 500\nevent: ping\ndata: {"ok":true}\n',
    ], "text/event-stream");

    await processServerEvents(response, data => seen.push(data));

    expect(seen).toEqual([{ type: "ping", ok: true }]);
  });

  it("rejects malformed streamed JSON with its parse error as the cause", async () => {
    const response = chunkedResponse([
      "data: not-json\n",
    ], "text/event-stream");

    await expect(processServerEvents(response, () => {})).rejects.toMatchObject({
      message: "Invalid streamed JSON data.",
      cause: expect.any(SyntaxError),
    });
  });

  it("does not disguise consumer errors as parse failures", async () => {
    const response = chunkedResponse([
      'data: {"ok":true}\n',
    ], "text/event-stream");
    const consumerError = new Error("Consumer failed");

    await expect(processServerEvents(response, () => {
      throw consumerError;
    })).rejects.toBe(consumerError);
  });

  it("cancels a still-open response when the consumer fails", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n'));
      },
      cancel() { cancelled = true; },
    });
    const error = new Error("Stop consuming");
    await expect(processServerEvents(new Response(body), () => {
      throw error;
    })).rejects.toBe(error);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});
