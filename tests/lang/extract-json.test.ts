import { describe, expect, it } from "vitest";
import extractJSON from "../../src/lang/json/extract-json.ts";

describe("extractJSON", () => {
  it("ignores closing brackets inside strings", () => {
    expect(extractJSON('Result: {"text":"a } bracket","ok":true} trailing'))
      .toEqual({ text: "a } bracket", ok: true });
  });

  it("prefers valid strict JSON over earlier prose brackets", () => {
    expect(extractJSON('See [the note] before {"value":42}.'))
      .toEqual({ value: 42 });
  });

  it("falls back to relaxed JSON syntax", () => {
    expect(extractJSON("Result: {value: 42, ready: true}"))
      .toEqual({ value: 42, ready: true });
  });

  it("returns null for unbalanced content", () => {
    expect(extractJSON('Result: {"value": 42')).toBeNull();
  });
});
