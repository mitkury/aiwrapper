import { describe, expect, it } from "vitest";
import { LangMessages } from "../../src/lang/messages.ts";

describe("LangMessages image inputs", () => {
  it("encodes byte images without the Node.js Buffer global", () => {
    const runtime = globalThis as typeof globalThis & {
      Buffer?: typeof Buffer;
    };
    const originalBuffer = runtime.Buffer;

    try {
      runtime.Buffer = undefined;

      const messages = new LangMessages();
      messages.addUserImages({
        kind: "bytes",
        bytes: new Uint8Array([104, 105]),
        mimeType: "text/plain",
      });

      expect(messages.userImages).toEqual([
        {
          type: "image",
          base64: "aGk=",
          mimeType: "text/plain",
        },
      ]);
    } finally {
      runtime.Buffer = originalBuffer;
    }
  });
});
