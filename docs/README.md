# Documentation

## Using AIWrapper

- [Usage callbacks](usage.md): provider reports, normalized units and accounting boundaries

- [Native Rust runtime](native.md): embedding, transport injection, compression, sandbox, compatibility
- [Quick start](../README.md)
- [Language providers](language-provider.md): text, structured output, images, provider setup
- [Agents and tools](agent.md): tool loops, results, events, cancellation
- [Live sessions](live-sessions.md): native voice, Gemini controls, connection events
- [Speech](speech.md): PCM, transcription, synthesis
- [Realtime agents](realtime-agent.md): STT → LLM → TTS orchestration
- [Playground](../playground/README.md): run the browser app
- [Camera context and 3D simulator](native-vision.md): bounded frame selection and visual testing
- [Rust cascade playground](native-cascade.md): native voice pipeline, setup and limits

## Development

- [Build](dev/build.md)
- [Testing](../tests/README.md)
- [AIModels catalog](dev/aimodels.md)
- [Dependency updates](dev/dependency-updates.md)
- [Shared agent guidance](airul/README.md): common rules and actions
- [Local development rules](dev/rules/README.md): repository conventions and checks
- [Agent actions](dev/actions-for-agents/README.md): focused development workflows

## Proposals and remaining work

- [Visual context experiments](dev/proposals/visual-context.md)

- [Rust cascade voice sessions](dev/proposals/rust-cascade-agent.md): Rust STT → LLM → TTS with browser playground validation
- [Complete the native Rust runtime](dev/proposals/native-rust.md)
- [Pluggable interruption detection](dev/proposals/interruption-detection.md)
- [Speaker verification and extraction](dev/proposals/speaker-verification-and-extraction.md)
