use aiwrapper::{speech::*, *};
use async_trait::async_trait;
use futures_util::StreamExt;
use std::{collections::BTreeMap, sync::Arc};
struct AudioFixture;
#[async_trait]
impl HttpTransport for AudioFixture {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse> {
        assert!(request.url.ends_with("/audio/speech"));
        assert_eq!(request.headers["authorization"], "Bearer key");
        Ok(HttpResponse {
            status: 200,
            headers: BTreeMap::new(),
            body: futures_util::stream::iter(vec![Ok(vec![1]), Ok(vec![0, 255]), Ok(vec![255])])
                .boxed(),
        })
    }
}
#[tokio::test]
async fn pcm_synthesis_reassembles_samples_split_across_chunks() {
    let speech = Speech::with_transport("key", "https://test/v1", Arc::new(AudioFixture));
    let frames: Vec<_> = speech
        .speak("Hi", "tts", "voice", CancellationToken::new())
        .await
        .unwrap()
        .collect()
        .await;
    let samples: Vec<_> = frames
        .into_iter()
        .flat_map(|f| f.unwrap().samples)
        .collect();
    assert_eq!(samples, vec![1, -1]);
}
#[test]
fn wav_is_mono_little_endian_with_accurate_lengths() {
    let frame = PcmFrame {
        samples: vec![1, -1],
        sample_rate: 24000,
    };
    let wav = frame.wav().unwrap();
    assert_eq!(&wav[..4], b"RIFF");
    assert_eq!(wav.len(), 48);
    assert_eq!(&wav[44..], &[1, 0, 255, 255]);
    assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 4);
}

mod common;

#[tokio::test]
async fn deepgram_aura_requests_raw_pcm_in_the_selected_voice() {
    let fixture = common::Fixture::new(vec![(200, "AB".into())]);
    let speech = Speech::with_transport("key", "https://test/v1", fixture.clone());
    let mut frames = speech
        .speak_deepgram("Hello", "aura-2-thalia-en", CancellationToken::new())
        .await
        .unwrap();
    let frame = frames.next().await.unwrap().unwrap();
    assert_eq!(frame.sample_rate, 24000);
    assert_eq!(frame.samples, vec![i16::from_le_bytes(*b"AB")]);
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(
        requests[0].0,
        "https://test/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000&container=none"
    );
    assert_eq!(requests[0].2["authorization"], "Token key");
    assert_eq!(requests[0].1, serde_json::json!({"text":"Hello"}));
}

#[tokio::test]
async fn gemini_transcription_preserves_encoded_audio_and_uses_the_injected_proxy() {
    let fixture = common::Fixture::new(vec![(
        200,
        r#"{"candidates":[{"content":{"parts":[{"text":"hello from audio"}]}}]}"#.into(),
    )]);
    let speech = Speech::with_transport(
        "scoped-token",
        "https://proxy.example/v1beta",
        fixture.clone(),
    );
    let text = speech
        .transcribe_gemini(
            b"original WebM bytes",
            "audio/webm;codecs=opus",
            "transcribe-model",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(text, "hello from audio");
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(
        requests[0].0,
        "https://proxy.example/v1beta/models/transcribe-model:generateContent"
    );
    assert_eq!(requests[0].2["x-goog-api-key"], "scoped-token");
    let parts = requests[0].1["contents"][0]["parts"].as_array().unwrap();
    let data = parts
        .iter()
        .find_map(|part| part.get("inlineData"))
        .unwrap();
    assert_eq!(data["mimeType"], "audio/webm");
    use base64::{Engine, engine::general_purpose::STANDARD};
    assert_eq!(
        STANDARD.decode(data["data"].as_str().unwrap()).unwrap(),
        b"original WebM bytes"
    );
}
#[tokio::test]
async fn gemini_transcription_of_silence_is_empty_and_other_empty_answers_fail() {
    let fixture = common::Fixture::new(vec![
        // Measured: 2 s of silent WebM/Opus to gemini-3.5-transcribe.
        (
            200,
            r#"{"candidates":[{"finishReason":"STOP","index":0}]}"#.into(),
        ),
        (
            200,
            r#"{"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}"#.into(),
        ),
        (200, r#"{"candidates":[{"finishReason":"SAFETY"}]}"#.into()),
        (200, r#"{"promptFeedback":{"blockReason":"OTHER"}}"#.into()),
        (200, "{not json".into()),
    ]);
    let speech = Speech::with_transport("key", "https://test/v1", fixture.clone());
    let token = CancellationToken::new();
    let transcribe = || speech.transcribe_gemini(b"clip", "audio/webm", "test", &token);
    assert_eq!(transcribe().await.unwrap(), "");
    assert_eq!(transcribe().await.unwrap(), "");
    assert!(matches!(transcribe().await, Err(Error::Protocol(m)) if m.contains("SAFETY")));
    assert!(matches!(transcribe().await, Err(Error::Protocol(_))));
    assert!(transcribe().await.is_err());
}
#[tokio::test]
async fn gemini_transcription_validates_input_before_sending_credentials() {
    let fixture = common::Fixture::new(vec![]);
    let speech = Speech::with_transport("key", "https://test/v1", fixture.clone());
    let token = CancellationToken::new();
    assert!(
        speech
            .transcribe_gemini(&[], "audio/webm", "test", &token)
            .await
            .is_err()
    );
    assert!(
        speech
            .transcribe_gemini(b"clip", "image/png", "test", &token)
            .await
            .is_err()
    );
    assert!(
        speech
            .transcribe_gemini(b"clip", "audio/webm", "../secret", &token)
            .await
            .is_err()
    );
    token.cancel();
    assert!(matches!(
        speech
            .transcribe_gemini(b"clip", "audio/webm", "test", &token)
            .await,
        Err(Error::Cancelled)
    ));
    assert!(fixture.requests.lock().unwrap().is_empty());
}

struct TimedFixture;
#[async_trait]
impl HttpTransport for TimedFixture {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse> {
        assert!(
            request
                .url
                .ends_with("/stream/with-timestamps?output_format=pcm_24000")
        );
        let body = concat!(
            "{\"audio_base64\":\"AQD//w==\",\"alignment\":{\"characters\":[\"H\",\"é\"],\"character_end_times_seconds\":[0.1,0.2]}}\n",
            "{\"audio_base64\":\"AAA=\",\"alignment\":{\"characters\":[\"!\"],\"character_end_times_seconds\":[0.3]}}"
        );
        // Split every byte, including inside UTF-8 and JSON. No final newline.
        Ok(HttpResponse {
            status: 200,
            headers: BTreeMap::new(),
            body: futures_util::stream::iter(
                body.as_bytes()
                    .iter()
                    .map(|b| Ok(vec![*b]))
                    .collect::<Vec<_>>(),
            )
            .boxed(),
        })
    }
}
#[tokio::test]
async fn elevenlabs_stream_preserves_original_utf8_offsets_and_audio_across_chunks() {
    use aiwrapper::speech_stream::SpeechEvent;
    let speech = Speech::with_transport("key", "https://test/v1", Arc::new(TimedFixture));
    let mut stream = speech
        .speak_elevenlabs_timed("Hé!", "model", "voice", 24000, CancellationToken::new())
        .await
        .unwrap();
    let (mut points, mut samples) = (vec![], vec![]);
    while let Some(event) = stream.next().await {
        match event.unwrap() {
            SpeechEvent::Timing(timing) => {
                points.extend(timing.into_iter().map(|p| (p.text_end, p.end_ms)))
            }
            SpeechEvent::Audio(frame) => samples.extend(frame.samples),
        }
    }
    assert_eq!(points, vec![(1, 100), (3, 200), (4, 300)]);
    assert_eq!(samples, vec![1, -1, 0]);
}
