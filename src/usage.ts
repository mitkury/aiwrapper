/** Provider reports, independent of pricing, persistence and application identity. */
export type Usage = Partial<Record<
  "inputTokens" | "outputTokens" | "totalTokens" | "cachedTokens" | "cacheWriteTokens" |
  "inputAudioTokens" | "outputAudioTokens" | "inputImageTokens" | "outputImageTokens" |
  "cachedAudioTokens" | "cachedImageTokens" | "reasoningTokens" | "audioSeconds" | "characters" | "costUsd",
  number
>>;
export type UsageEvent = {
  id: string;
  provider: string;
  model: string;
  operation: string;
  requestId?: string;
  usage: Usage;
  rawUsage: Record<string, unknown>;
};
export type UsageHandler = (event: UsageEvent) => void | Promise<void>;

const object = (v: any): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const sum = (...values: unknown[]): number | undefined => values.some(v => number(v) !== undefined)
  ? values.reduce<number>((total, v) => total + (number(v) ?? 0), 0) : undefined;

/** Missing counts remain absent. Modality/cache/reasoning counts are subsets of totals. */
export function normalizeUsage(provider: string, raw: Record<string, any>): Usage {
  const out: Usage = {};
  const put = (key: keyof Usage, value: unknown) => { const n = number(value); if (n !== undefined) out[key] = n; };
  if (provider === "google") {
    put("inputTokens", sum(raw.promptTokenCount, raw.toolUsePromptTokenCount));
    put("outputTokens", sum(raw.responseTokenCount ?? raw.candidatesTokenCount, raw.thoughtsTokenCount));
    put("cachedTokens", raw.cachedContentTokenCount);
    put("reasoningTokens", raw.thoughtsTokenCount);
    const modalities = (keys: string[], kinds: string[]) => {
      const counts = keys.flatMap(key => Array.isArray(raw[key]) ? raw[key] : [])
        .filter(d => kinds.includes(String(d?.modality).toUpperCase())).map(d => d.tokenCount);
      return sum(...counts);
    };
    const output = raw.responseTokensDetails ? "responseTokensDetails" : "candidatesTokensDetails";
    put("inputAudioTokens", modalities(["promptTokensDetails", "toolUsePromptTokensDetails"], ["AUDIO"]));
    put("inputImageTokens", modalities(["promptTokensDetails", "toolUsePromptTokensDetails"], ["IMAGE", "VIDEO"]));
    put("outputAudioTokens", modalities([output], ["AUDIO"]));
    put("outputImageTokens", modalities([output], ["IMAGE"]));
    put("cachedAudioTokens", modalities(["cacheTokensDetails"], ["AUDIO"]));
    put("cachedImageTokens", modalities(["cacheTokensDetails"], ["IMAGE", "VIDEO"]));
    if (typeof raw.totalBilledTime === "string" && /^\d+(\.\d+)?s$/.test(raw.totalBilledTime)) put("audioSeconds", Number(raw.totalBilledTime.slice(0, -1)));
  } else if (provider === "amazon") {
    const delta = raw.details?.delta;
    put("inputTokens", sum(delta?.input?.speechTokens, delta?.input?.textTokens));
    put("outputTokens", sum(delta?.output?.speechTokens, delta?.output?.textTokens));
    put("inputAudioTokens", delta?.input?.speechTokens);
    put("outputAudioTokens", delta?.output?.speechTokens);
  } else if (provider === "anthropic" || provider === "bedrock") {
    const input = provider === "bedrock" ? raw.inputTokens : raw.input_tokens;
    const read = provider === "bedrock" ? raw.cacheReadInputTokens : raw.cache_read_input_tokens;
    const write = provider === "bedrock" ? raw.cacheWriteInputTokens : raw.cache_creation_input_tokens;
    put("inputTokens", sum(input, read, write));
    put("outputTokens", provider === "bedrock" ? raw.outputTokens : raw.output_tokens);
    put("cachedTokens", read);
    put("cacheWriteTokens", write);
  } else if (provider === "ollama") {
    put("inputTokens", raw.prompt_eval_count);
    put("outputTokens", raw.eval_count);
  } else if (provider === "cohere") {
    put("inputTokens", raw.billed_units?.input_tokens);
    put("outputTokens", raw.billed_units?.output_tokens);
  } else {
    put("inputTokens", raw.input_tokens ?? raw.prompt_tokens ?? raw.inputTokens);
    put("outputTokens", raw.output_tokens ?? raw.completion_tokens ?? raw.outputTokens);
    const input = raw.input_token_details ?? raw.input_tokens_details ?? raw.prompt_tokens_details ?? {};
    const output = raw.output_token_details ?? raw.output_tokens_details ?? raw.completion_tokens_details ?? {};
    put("cachedTokens", input.cached_tokens ?? raw.cacheReadInputTokens ?? raw.prompt_cache_hit_tokens);
    put("cacheWriteTokens", input.cache_write_tokens ?? raw.cacheWriteInputTokens);
    put("inputAudioTokens", input.audio_tokens);
    put("inputImageTokens", input.image_tokens);
    put("outputAudioTokens", output.audio_tokens);
    put("outputImageTokens", output.image_tokens);
    put("cachedAudioTokens", input.cached_tokens_details?.audio_tokens);
    put("cachedImageTokens", input.cached_tokens_details?.image_tokens);
    put("reasoningTokens", output.reasoning_tokens);
    put("audioSeconds", raw.seconds ?? raw.audio_seconds);
    put("characters", raw.characters ?? raw.characterCost);
  }
  if (provider !== "amazon") put("totalTokens", raw.total_tokens ?? raw.totalTokenCount ?? raw.totalTokens);
  if (provider === "openrouter") put("costUsd", raw.cost);
  return out;
}

/** Internal accumulator: snapshots replace fields; they are never added together. */
export class UsageReport {
  private raw?: Record<string, unknown>;
  private requestId?: string;
  private finished = false;
  constructor(private handler: UsageHandler | undefined, private provider: string, private model: string, private operation = "chat") {}
  observe(value: any): void {
    if (!this.handler || !object(value)) return;
    const response = value.response ?? value.message ?? value;
    if (typeof (response.model ?? value.modelVersion ?? value.model) === "string") this.model = response.model ?? value.modelVersion ?? value.model;
    if (typeof (response.id ?? value.responseId) === "string") this.requestId = response.id ?? value.responseId;
    this.update(value.usageMetadata ?? response.usage ?? value.usage ?? value.delta?.usage ?? value.metadata?.usage);
    if (this.provider === "ollama" && value.done) {
      const raw: Record<string, unknown> = {};
      for (const key of ["prompt_eval_count", "eval_count", "total_duration", "load_duration", "prompt_eval_duration", "eval_duration"]) if (key in value) raw[key] = value[key];
      this.update(raw);
    }
  }
  update(raw: unknown): void { if (object(raw)) this.raw = { ...this.raw, ...raw }; }
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.raw || !this.handler) return;
    emitUsage(this.handler, this.provider, this.model, this.operation, this.raw, this.requestId);
  }
}

export function emitUsage(handler: UsageHandler | undefined, provider: string, model: string, operation: string, raw: unknown, requestId?: string, id?: string): void {
  if (!handler || !object(raw)) return;
  const event: UsageEvent = {
    id: id ?? globalThis.crypto.randomUUID(), provider, model: model.replace(/^models\//, ""), operation,
    ...(requestId ? { requestId } : {}), usage: normalizeUsage(provider, raw), rawUsage: raw,
  };
  try { void Promise.resolve(handler(event)).catch(() => {}); } catch { /* Observers do not change inference results. */ }
}
