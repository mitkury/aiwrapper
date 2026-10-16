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
