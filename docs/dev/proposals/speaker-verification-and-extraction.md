# Speaker verification and target-speaker extraction

Status: proposed

## Decision

AIWrapper should eventually provide pluggable contracts for three separate
capabilities:

- **Speaker enrollment** creates a reference for one consenting user.
- **Speaker verification** compares new speech with that reference.
- **Target-speaker extraction** produces PCM containing primarily the enrolled
  speaker when voices overlap.

The application should own microphone selection, spatial filtering, consent,
reference storage, acceptance thresholds, and the decision to admit audio into
STT or interruption detection.

The first implementation should be proven in a real consuming application
before these contracts are added to AIWrapper. Hardware, microphone placement,
and deployment noise affect the result as much as the model does.

## Why these are separate

Enrollment normally converts clean speech into a provider-specific speaker
embedding or remote enrollment ID. Verification is a one-to-one comparison that
returns a score. It can reject speech from another person, but it cannot remove
that person from audio in which both people speak simultaneously.

Extraction is the more expensive overlap case. It uses the enrolled reference
to isolate the target voice and returns new audio for STT. It must therefore be
a separate optional stage rather than a hidden part of verification.

The term "voice lock" is useful product language, but the API should use the
more precise capability names. None of these capabilities guarantees that every
accepted sample came from the wearer.

## Wearable-device flow

For glasses, the strongest design combines device evidence with voice models:

```text
microphones and optional vibration sensors
  -> echo cancellation, beamforming, and near-field filtering
  -> speech activity detection
  -> speaker verification against the session enrollment
  -> accepted PCM -> interruption logic and STT
```

The application should buffer the short verification window. If it matches,
the buffer and following frames enter the user turn. If it does not, they are
discarded. Other voices must not trigger an interruption merely because VAD
found speech.

When speakers overlap, verification alone is insufficient:

```text
mixed PCM + enrolled speaker reference
  -> target-speaker extraction
  -> extracted PCM
  -> verification and STT
```

The application decides whether the latency and compute cost of extraction are
acceptable. Directional microphones or wearer-contact sensors may solve enough
of the problem that extraction is unnecessary on some devices.

## Proposed AIWrapper contracts

All audio should use the existing `PcmAudioFrame` contract. Enrollment and
verification should use sessions so local streaming models and remote batch
providers can share the same application shape.

```ts
type SpeakerReference = {
  provider: string;
  model: string;
  payload: Uint8Array | string;
};

type SpeakerVerificationResult = {
  score: number;
  matched?: boolean;
};

interface SpeakerEnrollmentSession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  finish(): Promise<{ reference: SpeakerReference; quality?: number }>;
  close(): Promise<void>;
}

interface SpeakerVerificationSession {
  appendAudio(frame: PcmAudioFrame): Promise<void>;
  finish(): Promise<SpeakerVerificationResult>;
  close(): Promise<void>;
}

interface SpeakerVerificationProvider {
  createEnrollmentSession(
    options?: { signal?: AbortSignal },
  ): Promise<SpeakerEnrollmentSession>;
  createVerificationSession(
    reference: SpeakerReference,
    options?: { signal?: AbortSignal },
  ): Promise<SpeakerVerificationSession>;
}
```

The provider creates both sessions and validates that a reference belongs to a
compatible provider and model. The exact serialized reference format is
provider-specific. Scores and quality values are also provider-relative and
must not be compared across models.

`matched` is optional because an application may need its own calibrated
threshold. A provider default can be useful for a playground, but it must not be
presented as universally safe.

Target-speaker extraction should be a separate streaming transform:

```ts
interface TargetSpeakerExtractor {
  extract(
    audio: AsyncIterable<PcmAudioFrame>,
    reference: SpeakerReference,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<PcmAudioFrame>;
}
```

Implementations must declare input and output formats and must not silently
resample. Model runtimes belong in optional adapters, not the base package.

## Enrollment and privacy rules

- Enrollment requires explicit application-level consent and a clear delete
  action.
- Collect more than one clean speech sample when possible and reject enrollment
  when quality is inadequate.
- AIWrapper must not persist, log, upload, or automatically reuse a speaker
  reference. Storage and encryption belong to the application.
- References are biometric data even when they cannot be converted back into
  intelligible speech.
- A model or reference version change must invalidate incompatible references
  explicitly rather than silently degrading matching.

Voice verification is not secure authentication by itself. Recordings,
synthetic speech, and replay through a nearby speaker are presentation attacks.
Authentication use requires explicit liveness or presentation-attack detection
and a calibrated security policy outside this proposal.

## Standards and interoperability

There is no universal interchange format for speaker embeddings. ISO/IEC
19794-13 defines an interchange format for recorded voice data, but explicitly
does not standardize feature or voice-model representations. References should
therefore remain tagged, opaque, and provider-specific.

ISO/IEC 19795 provides a framework for measuring biometric error rates. We
should evaluate false acceptance, false rejection, failure to enroll, channel
mismatch, noise, and short utterances rather than advertising a single
"accuracy" value. Presentation attacks are evaluated separately under the
ISO/IEC 30107 family.

## Delivery order

1. Prototype enrollment and verification in a consuming application with one
   local model and device-side acoustic preprocessing.
2. Test multiple speakers, distances, rooms, noise levels, and overlapping
   speech using consented or licensed recordings.
3. Establish threshold, enrollment-quality, cancellation, and reference-version
   behavior.
4. Extract unstable AIWrapper contracts with deterministic mocks and one real
   adapter.
5. Add target-speaker extraction only after overlapping speech is demonstrated
   as a material failure in the target device pipeline.
6. Add presentation-attack detection as a separate capability if voice matching
   becomes part of authentication or authorization.

## Non-goals

- One-to-many speaker identification or maintaining a gallery of people
- Speaker diarization or naming every speaker in a conversation
- Treating a similarity score as proof of identity
- Hiding device-specific beamforming, echo cancellation, or sensor fusion
- A universal embedding format or universal matching threshold
- Retaining biometric data on behalf of the application

## Tests

AIWrapper tests should cover enrollment quality failure, compatible and
incompatible references, matching and non-matching speakers, abort, close,
sample-rate changes, deterministic mocks, and extraction format declarations.
Model adapters should report false-accept and false-reject behavior on declared
evaluation data. Application integration tests should verify that rejected
voices do not reach STT or trigger interruption and that accepted buffered
audio is not lost.

## References

- [AIWrapper speech-provider contract](../../speech.md)
- [NIST Speaker Recognition Evaluation](https://sre.nist.gov/)
- [ISO/IEC 19794-13 voice data interchange](https://www.iso.org/standard/72276.html)
- [ISO/IEC 19795-1 biometric performance testing](https://www.iso.org/standard/73515.html)
- [ISO/IEC 30107-1 presentation-attack detection](https://www.iso.org/standard/83828.html)
- [Google VoiceFilter target-speaker separation](https://research.google/pubs/voicefilter-targeted-voice-separation-by-speaker-conditioned-spectrogram-masking/)
- [ECAPA-TDNN speaker embeddings](https://arxiv.org/abs/2005.07143)
