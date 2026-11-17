# Voice framework source review

Reviewed November 17, 2026 for the [Rust cascade proposal](rust-cascade-agent.md).

Three repositories were shallow-cloned and inspected locally. This is a source
and test review, not a latency benchmark or production audit. Test cases were
read, not executed; no provider sessions were run.

| Project and inspected revision | Useful reference | Fit for AIWrapper |
| --- | --- | --- |
| [LiveKit Agents](https://github.com/livekit/agents/tree/0cfc0306335cc8b3633ec2cdce072a3f340cb14e) | Playback-aware output, recoverable speech pauses, speculative generation | Strong reference; adopting the inspected Python runtime adds a separate language/runtime boundary. |
| [Pipecat](https://github.com/pipecat-ai/pipecat/tree/6203e080683aaaaf49d4f801d75eb22526ee0a68) | Explicit turn strategies, provisional-context speculation, ordered text/audio frames | Strong alternative if a Python service is acceptable; it does not directly embed into the Rust crate. |
| [Gradbot](https://github.com/gradium-ai/gradbot/tree/5db5cc8823800c12e07baf10917164554489fc91) | Rust stream multiplexing, bounded channels, stale-turn filtering | Smaller Rust reference, but concrete Gradium speech clients and its own LLM/history/tool model prevent a drop-in fit. |

The recommendation remains a small Rust cascade over AIWrapper's existing
providers and `LiveAgent`. This is an architectural choice based on the Rust
embedding requirement, not evidence that these frameworks are slower.

## LiveKit Agents

Its media boundary is more flexible than a room-only description suggests.
[`voice/io.py`](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/livekit-agents/livekit/agents/voice/io.py)
defines custom audio inputs and outputs. Outputs expose pause capability,
playback progress, completion, played position, and an optional synchronized
transcript. A room is one integration, not the only possible media source.
This is the closest reference for AIWrapper's host playback contract.

In [`agent_activity.py`](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/livekit-agents/livekit/agents/voice/agent_activity.py),
speech interruption can pause output without immediately destroying the speech
handle. End of speech arms false-interruption recovery; a committed turn can
prevent resumption. Pause support is a declared output capability. Model pause,
confirmation, cancellation, and resume separately, with one owner for transitions.

The implementation waits for playout, clears output on interruption, and uses a
synchronized transcript when supplied. It checks whether the current speech ever
reached output, so a previous segment's completion is not mistaken for current
progress. Synchronization is not universally exact: the
[`transcription synchronizer`](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/livekit-agents/livekit/agents/voice/transcription/synchronizer.py)
also contains estimated word pacing. Keep alignment quality explicit.

Preemptive generation keeps copied context and tracks tools and tool choice.
A stale transcript cancels it. This revision optionally starts TTS before
scheduling through `preemptive_tts`; “LiveKit always waits to synthesize” would
be inaccurate. AIWrapper can intentionally begin with LLM-only speculation.

Useful test references:

- [`test_agent_interruptions.py`](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/tests/test_agent_interruptions.py): recovery waits for a pending turn decision; a committed turn prevents resume; teardown does not resume paused speech; cancellation does not poison subsequent turns.
- [`test_transcription_timeout.py`](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/tests/test_transcription_timeout.py): missing transcription is observable rather than an indefinite wait.
- [`fake_io.py`](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/tests/fake_io.py): media behavior can be tested without physical audio devices.

The framework's [code license](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/LICENSE)
is Apache-2.0. Its separate [model license](https://github.com/livekit/agents/blob/0cfc0306335cc8b3633ec2cdce072a3f340cb14e/MODEL_LICENSE)
restricts covered models to use with LiveKit Agents. Do not treat those weights
as an independently reusable AIWrapper turn detector.

## Pipecat

Pipecat is not tied to one media transport. Its
[`transports` directory](https://github.com/pipecat-ai/pipecat/tree/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/transports)
includes local audio, WebSocket, SmallWebRTC, Daily, and LiveKit integrations.
The adoption tradeoff is its Python processing runtime and frame lifecycle,
not a requirement to use one hosted media service.

[`user_turn_strategies.py`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/turns/user_turn_strategies.py)
separates turn starts from stops and makes combination rules explicit.
Provider-owned turns are configured deliberately rather than silently racing a
second local endpoint detector. AIWrapper initially needs a small mode selector,
not the whole strategy-composition framework.

[`EagerUserTurnStopStrategy`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/turns/user_stop/eager_user_turn_stop_strategy.py)
invalidates on resumed speech, a mismatched committed transcript, or a deadline.
It supports normalized or exact transcript matching. AIWrapper should initially
use exact matching plus tools, instructions, context, and image revisions.

[`SpeculationGate`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/turns/speculation_gate.py)
distinguishes held output from discarded output and lets control messages pass
while data is held. It handles confirmation arriving before the response starts.
Its buffer is unbounded locally and relies on the caller's speculation deadline;
AIWrapper should impose a byte/item cap as well. A timeout alone does not bound
memory when a model produces output quickly.

The [`eager-turn tests`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/tests/test_eager_user_turn_strategies.py)
cover provisional context, held text, speculative tools, mismatches, confirmation
mid-stream, and a matching final arriving after speculation expired. Reproduce
these cases with AIWrapper's own fixtures.

The [`TTS service`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/services/tts_service.py)
orders text/audio by synthesis context. The
[`output transport`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/transports/base_output.py)
forwards successfully written output and limits stalled writes; the
[`assistant aggregator`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/processors/aggregators/llm_response_universal.py)
builds context from received frames. That ordering is useful, but a successful
server write is not a browser playback acknowledgement. Preserve AIWrapper's
explicit device-progress boundary.

Pipecat's [code license](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/LICENSE)
is BSD-2-Clause. Its
[`local Smart Turn adapter`](https://github.com/pipecat-ai/pipecat/blob/6203e080683aaaaf49d4f801d75eb22526ee0a68/src/pipecat/audio/turn/smart_turn/local_smart_turn_v3.py)
uses ONNX Runtime and 16 kHz model input with resampling.
[Smart Turn](https://github.com/pipecat-ai/smart-turn) is a component candidate,
not a full framework. Inspect the selected model artifact and benchmark it
before adding a Rust dependency. This review inspected the adapter and project
page; the standalone model repository was not cloned or run.

## Gradbot

[`multiplex.rs`](https://github.com/gradium-ai/gradbot/blob/5db5cc8823800c12e07baf10917164554489fc91/gradbot_lib/src/multiplex.rs)
contains a Rust Listening/Flushing/Processing state machine, separate input/output
loops, bounded Tokio channels, and turn IDs rejecting stale audio, text, and
completion events. It illustrates keeping a session alive across many frames.
The [`server`](https://github.com/gradium-ai/gradbot/blob/5db5cc8823800c12e07baf10917164554489fc91/gradbot_server/src/server.rs)
and browser demos provide a persistent host example.

The core uses concrete Gradium speech clients and its own OpenAI-compatible LLM
session, and includes codec/resampling concerns. Adopting it means replacing or
bridging these pieces to AIWrapper's contracts. Its
[README](https://github.com/gradium-ai/gradbot/blob/5db5cc8823800c12e07baf10917164554489fc91/README.md)
positions it for prototyping and directs production users to LiveKit or Pipecat.
Rust implementation alone does not establish equivalent maturity.

Its output loop records transmitted TTS text, and
[`llm.rs`](https://github.com/gradium-ai/gradbot/blob/5db5cc8823800c12e07baf10917164554489fc91/gradbot_lib/src/llm.rs)
uses that text for subsequent history. The inspected input protocol accepts audio
and configuration, not client playback cursors. This does not establish which
words a browser played. Borrow stale-turn filtering, not that heard-history
assumption. Its tool-wait path also uses pending placeholders for holding speech;
retain AIWrapper's distinction between actual outcomes and status narration.

The repository is dual licensed under
[MIT](https://github.com/gradium-ai/gradbot/blob/5db5cc8823800c12e07baf10917164554489fc91/LICENSE-MIT)
or [Apache-2.0](https://github.com/gradium-ai/gradbot/blob/5db5cc8823800c12e07baf10917164554489fc91/LICENSE-APACHE).

## Changes to the proposal

Add explicit turn ownership, capability-based pause support, bounded pending
transcription/playback states, and control delivery that audio cannot starve.
Later speculation needs a deadline, memory cap, and complete request identity.
Add the upstream race and teardown scenarios to the test plan.

Use LiveKit as the main playback/interruption reference, Pipecat as the main
turn/speculation reference, and Gradbot as a smaller Rust concurrency reference.
Keep the first deliverable a Rust-backed browser session with measured behavior.
No source was copied into the runtime and no framework dependency was added.
