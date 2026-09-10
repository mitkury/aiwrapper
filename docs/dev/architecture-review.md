# Architecture review

Reviewed the message model, language providers, agents, live adapters, speech
providers, stream utilities, package exports, and the Playground's session
transport in September 2026.

## Boundaries to keep

`LangMessages` holds provider-neutral conversation content. `LanguageProvider`
translates a request into the provider protocol. `ChatAgent` owns the repeated
model/tool loop. `LiveLang` connects persistent native-audio sessions, while
`RealtimeAgent` composes STT, language, and TTS providers. Applications own media
capture, playback, credentials, and transport.

These are useful distinctions. Native live models and the speech cascade have
different turn-taking and transport requirements; sharing `LangTool`, PCM, and
small helpers is enough without making them inherit a single model lifecycle.

## Problems addressed

- Tool results were only appended after an entire batch succeeded. Cancelling
  a later call could lose evidence of earlier completed work. Completed results
  now survive cancellation, and cancellation carries the partial conversation.
- `ChatAgent` could return a provider's partial result while retaining its old
  history. It now retains the returned partial conversation for the next run.
- Live socket closure did not consistently abort handlers, and queued messages
  could continue after closure. Closing and failing a socket now share cleanup;
  event delivery stops at close, and handlers receive cancellation.
- Slow tools blocked live incoming-message processing. Tool completion now runs
  separately, allowing errors and interruption events through immediately.
  The compatible adapters also suppress an old tool batch's continuation after
  interruption or a newer response.
- Live result serialization ran repeatedly and could differ from the observed
  result. Results are normalized once, including structured errors for values
  without a JSON representation.
- A failing stream consumer could leave a response body open. Cleanup now
  cancels the reader. Nova also closes clients on connection failure and closes
  transports returned after connection cancellation.
- Cancellation helpers and byte encoders were duplicated across subsystems.
  Shared internal helpers now cover those operations without Node globals.

## Follow-ups worth doing deliberately

Connection state needs a consistent public contract. Live sessions expose error
events but no terminal close event, and STT sessions have no asynchronous error
callback. Consumers cannot reliably distinguish a recoverable turn error from a
dead connection. The next useful step is a terminal connection event for live
sessions and an error callback for STT, wired through the Playground so its
connection state follows the actual transport.

Tool cancellation currently follows a live session, not individual turns.
Provider-specific cancellation messages need explicit mapping before promising
per-turn cancellation. Completed side effects cannot be undone. Add that mapping
with tests for cancelled calls, overlapping turns, and late results; avoid
silently treating every interruption as permission to retry a tool.

The public live vocabulary still includes `SpeechToSpeech` factory names and
types alongside `LiveLang` aliases. Make `LiveLang` the canonical internal
contract in a dedicated migration, update first-party usage, and remove old
names with an explicit API change. They are not a reason to add another wrapper.

`LangMessages` combines content with request flags and available handlers.
Copies are shallow, and providers do not all return the same container instance.
Do not run concurrent requests against shared messages. A future simplification
should choose one ownership rule before adding more mutable request metadata.

The Playground's in-memory registries expire idle sessions only when another
request checks the registry. This is adequate for manual local testing but not
a production session service. A production adapter needs scheduled expiry and
bounded buffering for connections that never attach their event reader.

Microphone capture and speech playback are still application-owned. Tests cover
protocol handling and cancellation, but cannot establish which words a user
actually heard. Durable interrupted conversation history needs playback
acknowledgements from the consuming application.
