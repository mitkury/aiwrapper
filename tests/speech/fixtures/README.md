# Speech fixture

`hello.pcm` says: “Hello there, please say hello back to me.”
It is raw 16 kHz, mono, signed 16-bit little-endian PCM, with 250 ms of leading
silence and one second of trailing silence. It contains synthesized speech,
not a microphone recording.

Generated once with Gemini `gemini-3.8-live`, voice `Kore`, reading the sentence
above without commentary. Its 24 kHz output was converted with FFmpeg:

```sh
ffmpeg -f s16le -ar 24000 -ac 1 -i /tmp/gemini-fixture-24k.pcm \
  -ar 16000 -ac 1 \
  -af 'adelay=250,apad=pad_dur=1' -f s16le tests/speech/fixtures/hello.pcm
```

Tests read the checked-in bytes; no fixture generation or audio conversion
runs during tests. Only the live provider under test requires credentials.
