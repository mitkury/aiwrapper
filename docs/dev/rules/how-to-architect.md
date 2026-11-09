# Runtime architecture

Apply the [shared architecture rules](../../airul/rules/how-to-architect.md).

Keep these boundaries clear:

- `LangMessages` in TypeScript and `Conversation` in Rust represent conversations.
- Provider modules translate messages, tools, options and streams at the API edge.
- `ChatAgent` owns its model/tool loop; callers can also use the lower-level
  provider API to own orchestration themselves.
- Speech, live sessions and image APIs stay separate where their lifecycles differ.
- Applications own credentials, persistence, tool permissions, media devices,
  WebRTC and frontend transport.

Before changing message shapes, tool results, lifecycle events or exports,
inspect the affected providers, tests, documentation and playground. Check
cancellation, retries, partial output and tool/result pairing across those paths.
TypeScript and Rust have different APIs and coverage; the
[native guide](../../native.md#compatibility-and-remaining-work) records the gap.

Support embedding and independent hosting through the same core. Keep executable
hosts separate from library code, and inject their services explicitly. Never
import a consuming application's API internals into the runtime.
