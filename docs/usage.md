# Usage callbacks

Set `onUsage` on a provider to receive its usage reports. The same handler can
collect reports from several instances. There is no global listener or storage.

```ts
import { Lang, type UsageEvent } from "aiwrapper";

const recordUsage = (event: UsageEvent) => {
  console.log(event.provider, event.model, event.usage, event.rawUsage);
};
const lang = Lang.openai({ apiKey: "...", onUsage: recordUsage });
await lang.ask("Hello");
```

The option is also available on language calls (`ask`/`chat`), live providers and
connections, speech transcription providers, OpenAI images and ElevenLabs HTTP
synthesis. A call/connection override replaces its provider's callback.

For Rust, share an `Arc` callback. The library reads no application configuration:

```rust,no_run
use aiwrapper::*;
use std::sync::Arc;

# async fn example() -> Result<()> {
let record: UsageHandler = Arc::new(|event| {
    println!("{} {} {:?}", event.provider, event.model, event.usage);
});
let lang = Lang::new(
    ProviderConfig::new(Provider::Openai, "gpt-4.1-mini")
        .with_api_key("...")
        .with_usage_handler(record.clone()),
)?;
lang.ask("Hello", &ChatOptions::default()).await?;
let mut live = live::LiveConfig::new(live::LiveProvider::Google, "live-model", "...");
live.on_usage = Some(record.clone());
let speech = speech::Speech::new("...", Provider::Google.base_url())?
    .with_usage_handler(record);
# let _ = (live, speech);
# Ok(()) }
```

## Event contract

Both runtimes serialize the same fields: `id`, `provider`, `model`, `operation`,
optional `requestId`, `usage` and `rawUsage`. Rust field names use snake_case.
Operations are `chat`, `live`, `transcription`, `speech-synthesis` and `image`.
The model is the one reported by the provider when available, otherwise the
model selected for the request. Live input transcription names its separate
transcription model.

`usage` projects understood units into optional nonnegative fields:

- `inputTokens`, `outputTokens`, `totalTokens`;
- `cachedTokens`, `cacheWriteTokens`, `reasoningTokens`;
- `inputAudioTokens`, `outputAudioTokens`, `inputImageTokens`, `outputImageTokens`,
  `cachedAudioTokens`, `cachedImageTokens`;
- `audioSeconds`, `characters`, and provider-reported `costUsd`.

Missing fields mean **not reported**. Modality, cached and reasoning counts are
subsets of totals, not extra tokens to add to them. Anthropic and Bedrock input
totals include their separately reported cache reads and writes; Cohere uses billed
units. `rawUsage` keeps the original usage fields, including unfamiliar fields,
so a consumer can audit or re-price a report. Rust exposes the normalized fields
in `Usage.counts`; TypeScript exports the `Usage` type and `normalizeUsage` helper.

## Coverage and delivery

| API | Reports |
| --- | --- |
| Rust language providers | OpenAI Responses, compatible Chat Completions presets including OpenRouter, Anthropic, Google, Ollama, Cohere |
| TypeScript language providers | The same protocols plus Bedrock ConverseStream |
| Rust live | Gemini `usageMetadata`; OpenAI response and input-transcription usage |
| TypeScript live | Gemini, OpenAI, compatible xAI/Azure reports; Nova Sonic usage deltas |
| Transcription | OpenAI batch (both runtimes), OpenAI realtime (TypeScript), Gemini (both); Google Cloud billed duration (Rust) |
| Images | OpenAI image endpoints (TypeScript); usage reported on language calls that produce images |
| Synthesis | ElevenLabs HTTP `character-cost` header (both runtimes), when supplied |

A language HTTP operation emits once with the latest merged usage snapshot.
Partial snapshots are not summed. Reports received before a stream failure,
abort, malformed output or schema rejection are still emitted. Rust also emits
observed usage when the caller drops the in-flight operation. Agent tool rounds
and compression use the same provider boundary and need no metering wrapper.

Live usage is emitted as reports arrive, including cancelled/failed OpenAI
responses. Gemini reports each billed turn; Nova exposes incremental counts in
`details.delta`, so its normalized counts use those deltas while `rawUsage`
retains the session totals. Continue polling the live receiver in Rust.

No callback is emitted without a usage report. In particular, OpenAI PCM TTS,
ElevenLabs WebSocket TTS, and the current Deepgram/ElevenLabs realtime
transcription protocols do not provide a per-call usage report through these
adapters. Local audio lengths and input character counts are not invoices.
Provider-owned tool charges and discounts may require separate provider billing
records; token totals alone do not establish the complete monetary charge.

## Persistence and costs

Callbacks run synchronously at the reporting boundary. They should enqueue work
quickly. TypeScript does not await returned promises; thrown errors/rejections
and Rust callback panics are isolated from inference. The host must make failed
persistence visible, drain its queue at shutdown and decide its retry policy.

Persist `id` with a unique constraint when forwarding/replaying an event. The ID
is retained when an event is serialized; OpenAI live reports use their provider
response/item ID. Reports without a provider report ID receive a generated ID.
A fresh call is a new operation; this is not an exactly-once delivery guarantee
across provider reconnections or process crashes.

The callback does not calculate prices, charge credits, enforce quotas, attach
customer identity or contact a billing service. OpenRouter's `usage.cost` is
preserved as `costUsd`; other providers generally need a dated external price
table. Preserve unknown prices as unknown rather than zero.

The older Rust `LiveEvent::Usage`, completion metadata and
`transcribe_gemini_with_usage` return value remain available. Use one accounting
path per operation to avoid booking those reports again alongside the callback.

Provider references: [Anthropic stream usage](https://platform.claude.com/docs/en/build-with-claude/streaming),
[OpenRouter usage](https://openrouter.ai/docs/use-cases/usage-accounting),
[Bedrock cache counts](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html),
[Nova Sonic events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html),
[ElevenLabs response headers](https://elevenlabs.io/docs/api-reference/introduction#tracking-generation-costs).
