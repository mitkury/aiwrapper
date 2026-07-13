import { describe, expect, it } from "vitest";
import {
  attachPartialResult,
  isAbortError,
  normalizeError,
  partialResultFrom,
} from "../../src/errors.ts";

describe("error utilities", () => {
  it("normalizes object-shaped abort errors", () => {
    const thrown = {
      name: "AbortError",
      message: "Stopped",
      partialResult: { answer: "partial" },
    };

    const normalized = normalizeError(thrown);

    expect(normalized).toMatchObject({ name: "AbortError", message: "Stopped" });
    expect(isAbortError(thrown)).toBe(true);
    expect(partialResultFrom(thrown)).toEqual({ answer: "partial" });
  });

  it("wraps non-extensible errors when attaching a partial result", () => {
    const thrown = new Error("Stopped");
    thrown.name = "AbortError";
    Object.freeze(thrown);
    const partial = { answer: "partial" };

    const error = attachPartialResult(thrown, partial);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AbortError");
    expect(error.partialResult).toBe(partial);
    expect(error.cause).toBe(thrown);
  });
});
