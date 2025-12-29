import { OpenAIChatCompletionsLang } from "../openai/openai-chat-completions-lang.ts";

export type GroqLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  includeReasoning?: boolean;
  bodyProperties?: Record<string, any>;
};

export class GroqLang extends OpenAIChatCompletionsLang {
  private includeReasoning?: boolean;

  constructor(options: GroqLangOptions) {
    const modelName = options.model || "llama3-70b-8192";
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      baseURL: "https://api.groq.com/openai/v1",
      bodyProperties: options.bodyProperties || {},
      maxTokens: options.maxTokens,
      reasoningEffort: options.reasoningEffort,
    });
    this.includeReasoning = options.includeReasoning;
  }

  protected override transformBody(body: Record<string, unknown>): Record<string, unknown> {
    const transformedBody = super.transformBody(body);
    
    // Transform model ID for GPT-OSS models - Groq API requires "openai/gpt-oss-20b" format
    if (this.isGPTOSSModel() && typeof transformedBody.model === "string") {
      const modelId = transformedBody.model;
      if (!modelId.startsWith("openai/")) {
        transformedBody.model = `openai/${modelId}`;
      }
    }
    
    // For GPT-OSS models, add include_reasoning parameter if specified
    // Default is true, so we only need to add it if it's explicitly false
    if (this.supportsReasoning() && this.isGPTOSSModel()) {
      if (this.includeReasoning === false) {
        transformedBody.include_reasoning = false;
      }
      // include_reasoning defaults to true, so we don't need to set it explicitly
    }
    
    return transformedBody;
  }

  private isGPTOSSModel(): boolean {
    if (!this.modelInfo) {
      return false;
    }
    const modelId = this.modelInfo.id.toLowerCase();
    return modelId.includes("gpt-oss");
  }
}
