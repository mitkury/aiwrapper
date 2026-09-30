# Speaker verification and extraction

Status: proposed; no speaker enrollment, verification, or extraction API is implemented.

Keep three optional capabilities separate:

- Enrollment creates an opaque reference from a consenting user's speech.
- Verification compares new speech with that reference and returns a score.
- Extraction produces PCM for the target speaker when voices overlap.

Verification can reject a speaker; it cannot separate overlapping voices.
Applications own audio preprocessing, consent, reference storage/deletion,
thresholds, and admission of buffered speech into STT or interruption detection.

## Proposed contracts

Use the existing PCM and session conventions. Enrollment sessions accept audio
and finish with a reference and optional quality information. Verification
sessions accept a compatible reference and audio and finish with a score.
Extraction is a separate cancellable streaming PCM transform.

References should carry provider/model identity and opaque payloads. Validate
compatibility explicitly. Scores are provider-relative, and an optional default
match threshold must not imply universal accuracy. Adapters declare formats and
must not silently resample. Heavy model runtimes remain optional dependencies.

AIWrapper should not persist, log, or automatically upload/reuse references.
The application owns consent and protection of this sensitive data. Voice
matching alone must not be presented as secure authentication; replay and
synthetic speech require a separate application security policy.

## Delivery and validation

Prototype enrollment and verification with one model in a consuming application
before extracting shared interfaces. Test consented or licensed speech across
speakers, noise, distances, short utterances, and overlapping speech. Add
extraction only when overlap is a demonstrated problem.

Contract tests should cover poor enrollment quality, incompatible references,
matching/non-matching fixtures, abort, close, and format changes. Application
tests should check false accepts/rejects, preservation of accepted buffered
speech, and rejection before STT or interruption. Identification, diarization,
hardware processing, and authentication are outside this proposal.

See [speech contracts](../../speech.md) and
[interruption detection](interruption-detection.md).
