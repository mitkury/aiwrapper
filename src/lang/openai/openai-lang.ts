import { OpenAIResponsesLang, type OpenAILangOptions } from "./responses/openai-responses-lang.js";

export class OpenAILang extends OpenAIResponsesLang {
  constructor(options: OpenAILangOptions) {
    const modelName = options.model || "gpt-5.4";
    super({ ...options, model: modelName });
  }
}
