# Pluggable interruption detection

Status: proposed; no standalone detector API is implemented.

STT adapters already expose speech-activity events, and `RealtimeAgent` can
interrupt on user speech. This proposal concerns a replaceable detector that
applications can use independently of those providers.

## Boundary

A detector reports speech start/end with sample offsets and optional confidence.
It accepts the existing PCM format, supports abort/reset/close, and declares its
accepted sample rates without silently resampling. Model runtimes belong in
optional adapters; a mock and a small reference implementation should come first.

The application decides whether detected speech is an interruption. It owns:

- sustained-speech thresholds, echo/backchannel rejection, and confirmation;
- playback pause/resume and LLM, TTS, and tool cancellation;
- history based on the audio actually played.

VAD alone cannot establish intent or which words were heard. A semantic turn
classifier would be a separate capability if multiple implementations need it.

## Delivery and validation

Prove pause → confirm → cancel/resume in a consuming application before
extracting a shared detector contract. Keep microphone processing, speaker
verification, and playback accounting outside that contract.

Use deterministic PCM fixtures for speech/noise/silence, sample offsets, format
changes, reset, abort, and close. Application tests must cover false interruption,
echo, shared cancellation, and history against the playback cursor.

See [speech contracts](../../speech.md) and [realtime agents](../../realtime-agent.md).
