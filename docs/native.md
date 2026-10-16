# Native Rust runtime

AIWrapper's `native/` crate embeds directly in a Rust application. It provides
async model calls, tool loops, optional history compression, HTTP speech and
Gemini/OpenAI live voice. It owns no HTTP listener, database, credentials store,
WebRTC peer connection or application session registry.

Use a Cargo path dependency during development, or a Git dependency pinned to a
reviewed commit. Cargo finds the `aiwrapper` package in the workspace:

```toml
aiwrapper = { path = "../aiwrapper/native" }
# Alternatively:
# aiwrapper = { git = "https://github.com/mitkury/aiwrapper", rev = "<commit>" }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
serde_json = "1"
```

The crate is version 0.1.0 and is not published to crates.io. Model names and
credentials are explicit. The library never reads environment variables.

## Inference and tools

```rust,no_run
use aiwrapper::*;
use serde_json::json;
use std::sync::Arc;

# async fn example() -> Result<()> {
let provider = Arc::new(Lang::new(
    ProviderConfig::new(Provider::Openai, "gpt-4.1-mini")
        .with_api_key(std::env::var("OPENAI_API_KEY").expect("API key")),
)?);
let mut agent = ChatAgent::new(provider);
agent.tools.push(Tool::new(
    "add", "Add two integers",
    json!({
        "type": "object",
        "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
        "required": ["a", "b"], "additionalProperties": false
    }),
    |args, context| async move {
        // Long-running handlers should observe context.cancellation.
        let _ = context;
        Ok(json!(args["a"].as_i64().unwrap() + args["b"].as_i64().unwrap()))
    },
));
let options = ChatOptions::default();
agent.run(vec![Message::user("Use add to calculate 2 + 3.")], &options, &mut |event| {
    // Send serializable events to the host's frontend transport if needed.
    println!("{}", serde_json::to_string(&event).unwrap());
}).await?;
println!("{}", agent.conversation.answer());
# Ok(()) }
```

`Lang.ask` returns a conversation. `Lang.chat` appends one model turn to a
mutable conversation, including partial output on failure. A one-turn provider
call returns tool requests without executing them. `ChatAgent` owns execution
and repeats inference, with an eight-call default limit. This differs from the
TypeScript provider API, which executes local handlers inside a provider call.

Each agent accepts an exclusive mutable borrow. Share an `Arc<Lang>` across
agents to reuse the HTTP client; keep one agent per active conversation.
`run` appends input; replace `agent.conversation` explicitly to restore history.

Handlers receive a call ID, name and cancellation token. Arguments are validated
before invocation. Tool errors become structured results. Completed results
remain in history if another tool is cancelled. The library does not drop a
running tool future on cancellation because it may have performed a side effect;
handlers must cooperate. Unresolved calls require explicit results before
resumption. AIWrapper never silently replays a tool or invents its outcome.

`ChatOptions.tools = Some(vec![])` disables tools for one run. `None` uses agent
registrations. `schema` accepts JSON Schema; final JSON is parsed and validated.
Malformed JSON is an error rather than a guessed repair. Anthropic uses
[its native output format](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
so select a model that supports structured output. `built_in_tools` accepts
provider definitions for Responses, Anthropic and Gemini. `body` and `headers`
are explicit escape hatches and override constructor values. Streaming must stay
enabled. Applications must not accept these overrides from an untrusted browser.

## Context compression

```rust,no_run
# use aiwrapper::*;
# use std::sync::Arc;
# fn example(agent: &mut ChatAgent) -> Result<()> {
let mut compression = Compression::new(80_000)?;
compression.on_checkpoint = Some(Arc::new(|checkpoint| Box::pin(async move {
    // Replace this with the host's durable checkpoint transaction.
    let encoded = serde_json::to_vec(&checkpoint)?;
    let _ = encoded;
    Ok(())
})));
agent.compression = Some(compression);
# Ok(()) }
```

The budget is model **input**, not the entire context window. Reserve output
space separately. Token counts use UTF-8 bytes divided by three plus overhead
and an image allowance; they are estimates, not a tokenizer or a promise that a
provider will accept a request. Choose conservative budgets for the model.

Compression keeps `agent.conversation` intact and creates a smaller request
projection. It summarizes complete older message groups, preserves instructions
and the latest user message, never splits tool calls from their results, and
folds bounded transcript chunks into a summary with tools disabled. Image bytes
become explicit placeholders. An empty, oversized or insufficient summary fails
without advancing the checkpoint. No request is retried after streamed output
or a tool side effect.

Checkpoints contain the summary, cut position, before/after estimates and a
SHA-256 digest of the covered history. Restoring a checkpoint against edited or
unrelated history fails, as do empty summaries and cut positions inside a tool
group. Summary requests retain the caller's headers and retry policy while
disabling tools and structured output. A configured persistence callback must
succeed before the in-memory checkpoint advances. Without a callback checkpoints
remain in memory. Persist history and checkpoints together in the host; the crate
does not choose a storage format beyond its serializable values.

Compression adds model calls and is opt-in. Context-overflow errors do not
trigger hidden retries. Provider-owned live compression is separate: pass
Gemini `contextWindowCompression` and `sessionResumption` in live settings.

## Injecting networking

`Lang::new` uses a pooled `reqwest` client with rustls, a 15-second connect timeout,
a 180-second request timeout and redirects disabled. `ReqwestTransport::with_client`
accepts an existing client with the host's timeout, proxy and TLS configuration.

For complete ownership of networking, implement one async method:

```rust,ignore
#[async_trait::async_trait]
impl aiwrapper::HttpTransport for HostTransport {
    async fn send(&self, request: aiwrapper::HttpRequest)
        -> aiwrapper::Result<aiwrapper::HttpResponse> {
        // Use the host's existing outbound service. Return status, headers and
        // a Stream<Item = Result<Vec<u8>>>; do not buffer the whole response.
        self.outbound.send(request).await
    }
}
let lang = Lang::with_transport(config, Arc::new(host_transport))?;
```

A request contains the URL, headers and body bytes. All current requests are
POST. Response header names should be lowercase. Dropping the send future or
response stream must release/cancel its underlying I/O. The provider handles
SSE/NDJSON, including split UTF-8 and multiline SSE. Individual event buffers
are limited to 8 MiB. HTTP retries apply only to rejected 429/502/503/504 requests,
are bounded and cancellation-aware; transport errors and partial streams are
not retried. Set `max_retries` to zero for host-owned retry policy.

Live networking has the corresponding `LiveTransport::connect` boundary,
returning JSON sink/stream halves. The default uses `tokio-tungstenite` over
WebSockets. These two transport traits and `LanguageProvider` are the extension
points; there is no middleware framework, runtime registry or global transport.

## Frontends and the sandbox

The normal application path is:

```text
Browser or mobile frontend
    -> application's authenticated HTTP / SSE / WebSocket / WebRTC interface
    -> Rust application: credentials, tool services, storage, cancellation
    -> AIWrapper crate
    -> provider HTTPS or WebSocket connection
```

The host maps events into its existing API and cancels the token on disconnect.
Avoid unbounded event queues. HTTP callbacks are synchronous; keep them short or
forward into a bounded channel with an explicit slow-consumer policy. Live audio
arrives through a polled stream, so a host can apply backpressure directly.

Run the existing browser chat sandbox against Rust:

```sh
npm ci
npm ci --prefix playground
npm run sandbox:native
```

This builds `native/examples/sandbox.rs`, then starts the existing playground
with `AIWRAPPER_RUNTIME=rust`. Server-side `.env` credentials stay on the server.
The frontend keeps its `/api/chat` NDJSON interface. The development host invokes
one native process per chat request over stdin/stdout; a Rust application imports
the crate directly and needs no subprocess. Cancelling the browser response
terminates the development process. Tools in this example are `add` and
`get_time`; they have no external side effects.

`AIWRAPPER_NATIVE_BINARY` selects an already-built example binary.
`AIWRAPPER_COMPRESSION_TOKENS` enables text compression in the sandbox, using an
in-memory checkpoint for that request. `AIWRAPPER_NATIVE_MOCK=1` is a server-only
offline test mode. Chat uses Rust; the existing speech and live browser pages
continue to use TypeScript until their native media host adapters are completed.
The native crate's speech/live APIs can already be embedded independently.

## Live voice and speech

```rust,no_run
use aiwrapper::{live::*, Role};
# async fn example() -> aiwrapper::Result<()> {
let mut config = LiveConfig::new(
    LiveProvider::Google, "gemini-3.8-live",
    std::env::var("GOOGLE_API_KEY").expect("API key"),
);
config.instructions = "Keep spoken answers brief.".into();
config.settings.insert("contextWindowCompression".into(),
    serde_json::json!({"slidingWindow": {}}));
config.settings.insert("sessionResumption".into(), serde_json::json!({}));
let mut session = config.connect().await?;
session.sender.send_text("Hello", Role::User, true).await?;
while let Some(event) = session.receiver.next_event().await? {
    if matches!(event, LiveEvent::ResponseEnded) { break; }
    // Forward PCM, transcripts and tool calls to the appropriate host task.
}
session.sender.close().await?;
# Ok(()) }
```

Connections wait for setup acknowledgement and have a bounded setup timeout.
Clone the sender for a microphone task while another task reads events. Frames
are mono signed 16-bit little-endian PCM: Gemini input is 16 kHz, OpenAI input
24 kHz, and output is 24 kHz. The host resamples and owns device playback.

Live tool results are JSON values; the native live adapter rejects multimodal
`tool-content` results explicitly. Live tool execution is manual: respond to `ToolCall` with `send_tool_results`.
Use registered `Tool::execute` handlers or the host's scheduler. Keep reading
media while handlers run. Calls are deduplicated within a connection; the host
owns durable deduplication across reconnects. Gemini cancellations suppress late
results. Resumption and expiry events let the host rotate connections without
the library inventing a reconnect policy.

OpenAI supports explicit interruption and audio truncation with the host's
actual playback cursor. Gemini interruptions follow provider input-activity
settings. Generated audio is not evidence of what the user heard. Hosts must
clear queued playback and persist accurate interrupted history themselves.

`Speech` supports OpenAI-compatible WAV transcription, Google synchronous
transcription, OpenAI PCM synthesis and ElevenLabs PCM synthesis. TTS yields PCM
frames with sample boundaries preserved across HTTP chunks. Use explicit model,
voice and language selections. The library does not include media-device access.

## Compatibility and remaining work

| Area | Native 0.1 |
| --- | --- |
| OpenAI Responses | Streaming, function tools, built-in tool passthrough, image output, reasoning replay, structured output |
| OpenAI-compatible services | Streaming chat, tools, image input, structured output where the provider accepts the schema |
| Groq, DeepSeek, Kimi, xAI, Mistral, OpenRouter | Named endpoint presets over Chat Completions |
| Anthropic | Streaming text/thinking/tools, signed-block replay, image input/tool output, native structured output with validation |
| Gemini | SSE inference, tools, signatures, inline images, native JSON Schema output |
| Ollama | Native NDJSON chat, tools, base64 image input, JSON Schema format |
| Cohere | Native v2 SSE, text and tool calls |
| Agent loop | Events, bounded iterations, handler validation, cancellation, preserved partial history |
| Text compression | Opt-in model-input projection and persistable checkpoints |
| Speech | Batch OpenAI/Google STT; OpenAI/ElevenLabs HTTP PCM TTS |
| Native live models | Gemini and OpenAI: PCM, text, images, manual tools, transcripts, interruption events and lifecycle controls |
| AWS Bedrock / Nova Sonic | Still TypeScript; native AWS adapters proposed |
| Other realtime STT/live providers and incremental TTS | Still TypeScript; proposed native ports |
| Continuous STT → LLM → TTS orchestration | Still TypeScript; proposed native port |
| Standalone image-generation facade, patch helper, model catalog API | Still TypeScript; Responses image generation is usable from native |

This is a working first native version, not complete replacement parity. The
[remaining migration proposal](dev/proposals/native-rust.md) tracks the rest.
Unsupported image tool results are rejected for Chat Completions and Ollama.
Gemini requires inline image bytes. Model-specific capabilities and API access
remain the provider's responsibility.

## Development

### Offline mock providers

`MockLang::new(replies)` consumes a fixed queue and fails when it is exhausted.
`MockLang::interactive()` instead echoes the current input and understands
`tool: <name> <JSON object>`. It requests only offered tools, leaves execution to
`ChatAgent`, and replies with the actual results, including errors. It does not
interpret commands inside tool output. Separate conversations can share it;
restoring saved history does not require restoring provider state.

```rust,no_run
use aiwrapper::*;
use std::sync::Arc;
# async fn example() -> Result<()> {
let mut agent = ChatAgent::new(Arc::new(MockLang::interactive()));
agent.tools.push(Tool::new("echo", "Echo inputs", serde_json::json!({"type":"object"}),
    |arguments, _| async move { Ok(arguments) }));
agent.run(vec![Message::user("tool: echo {\"text\":\"hello\"}")],
    &ChatOptions::default(), &mut |_| {}).await?;
# Ok(()) }
```

For compression, structured output, errors or a task that needs several tool
turns, use `MockLang::from_fn(|conversation, options| -> Result<Message> { ... })`.
The callback sees the actual projected context and request options; it can assert
what was retained and decide its next reply from tool results and summaries.
All mock modes stream text in Unicode-safe increments and honor cancellation.
Structured answers are checked against the requested schema. The synchronous
callback performs no I/O; capture a mutex or atomics for test recording.

The interactive mode deliberately rejects summary and structured-output requests.
Supply explicit fixtures with `from_fn` instead of treating an echo as a summary.
The [compression scenarios](../native/tests/mock_compression.rs) simulate a task
that completes numbered reads. Each large tool result forces bounded summaries;
the next read must follow the progress retained in the projected context. Tests
cover repeated compression, Unicode and escaped data, saved-history restart,
failed persistence, cancellation and failure halfway through summarization.
They verify compression mechanics and exact-once tool execution in those
scenarios; they do not evaluate a real model's summary quality.

Run just the mock scenarios with:

```sh
cargo test --locked -p aiwrapper --test mock --test mock_compression
```

For manual offline chat, run `AIWRAPPER_NATIVE_MOCK=1 npm run sandbox:native`
and send `tool: add {"a":2,"b":3}`. Leave
`AIWRAPPER_COMPRESSION_TOKENS` unset in this interactive mode; compression uses
the programmable fixtures above. No API key is needed for the native process.

### Checks

```sh
npm run native:check
npm run native:build
npm run native:test:sandbox
cargo test --locked --test provider_live -- --ignored
cargo test --locked --test live_provider -- --ignored
```

Default tests are deterministic and do not require credentials. They cover all
protocol families, injected networking, real loopback HTTP/WebSocket servers,
schema validation, agent cancellation, compression failure and PCM framing.
The ignored live test requires exported OpenAI, Google and Anthropic credentials
and makes billable calls. It checks a real tool loop and structured output for
each. Keep it separate from CI and releases.

The Rust dependency replacements are `reqwest`/rustls for fetch, `serde` and
`serde_json` for wire data, `jsonschema` for AJV, `tokio-tungstenite` for ws, and
Tokio cancellation/futures for asynchronous work. Hosts can use `schemars` to
produce JSON Schema instead of Zod; no schema-builder dependency is required.
JSONic-style repairs are intentionally absent. See the upstream documentation
for [reqwest](https://docs.rs/reqwest/0.12/reqwest/),
[jsonschema](https://docs.rs/jsonschema/0.33/jsonschema/) and
[tokio-tungstenite](https://docs.rs/tokio-tungstenite/0.28/tokio_tungstenite/).
