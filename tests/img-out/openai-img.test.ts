import { afterEach, describe, expect, it } from "vitest";
import { OpenAIImg } from "../../src/img/openai-img.ts";
import { setHttpRequestImpl } from "../../src/http-request.ts";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  setHttpRequestImpl((url, options) => nativeFetch(url, options as RequestInit));
});

describe("OpenAIImg", () => {
  it("returns generated base64 images in the conversation", async () => {
    setHttpRequestImpl(async () => new Response(JSON.stringify({
      data: [
        {
          b64_json: "aGVsbG8=",
          output_format: "png",
          revised_prompt: "A gray mug",
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await new OpenAIImg({ apiKey: "test" }).generate("A mug");

    expect(result.finished).toBe(true);
    expect(result.assistantImages).toEqual([
      {
        type: "image",
        base64: "aGVsbG8=",
        mimeType: "image/png",
        metadata: { revisedPrompt: "A gray mug" },
      },
    ]);
  });

  it("returns edited image URLs and forwards response_format", async () => {
    let form: FormData | undefined;
    setHttpRequestImpl(async (_url, options: any) => {
      form = options.body;
      return new Response(JSON.stringify({
        data: [{ url: "https://example.com/edited.png" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await new OpenAIImg({ apiKey: "test" }).edit({
      prompt: "Make it blue",
      image: { kind: "base64", base64: "aGVsbG8=", mimeType: "image/png" },
      responseFormat: "url",
    });

    expect(result.assistantImages[0].url).toBe("https://example.com/edited.png");
    expect(form?.get("response_format")).toBe("url");
  });
});
