//! Streaming speech boundaries. Devices and resampling remain host-owned.
use crate::{
    speech::{PcmFrame, Speech},
    *,
};
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt, stream::BoxStream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::{Message as WsMessage, client::IntoClientRequest};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TranscriptionEvent {
    Started {
        id: String,
    },
    Transcript {
        id: String,
        text: String,
        committed: bool,
    },
    Observation {
        event: Value,
    },
}
#[async_trait]
pub trait SpeechInput: Send + Sync {
    fn sample_rate(&self) -> u32;
    async fn append(&self, frame: &PcmFrame) -> Result<()>;
    /// Ask the provider to finish the active turn; no interim text is promoted.
    async fn end_turn(&self) -> Result<()>;
    async fn close(&self) -> Result<()> {
        Ok(())
    }
}
pub struct TranscriptionSession {
    pub input: Arc<dyn SpeechInput>,
    pub events: BoxStream<'static, Result<TranscriptionEvent>>,
}

pub struct DeepgramFlux {
    pub api_key: String,
    pub model: String,
    pub sample_rate: u32,
}
impl DeepgramFlux {
    pub async fn connect(&self, cancellation: CancellationToken) -> Result<TranscriptionSession> {
        if self.api_key.is_empty()
            || ![8000, 16000, 24000, 44100, 48000].contains(&self.sample_rate)
        {
            return Err(Error::Invalid(
                "Deepgram requires a key and a supported PCM sample rate".into(),
            ));
        }
        let mut url = reqwest::Url::parse("wss://api.deepgram.com/v2/listen").unwrap();
        url.query_pairs_mut()
            .append_pair("model", &self.model)
            .append_pair("encoding", "linear16")
            .append_pair("sample_rate", &self.sample_rate.to_string());
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|_| Error::Invalid("invalid speech URL".into()))?;
        request.headers_mut().insert(
            "authorization",
            format!("Token {}", self.api_key)
                .parse()
                .map_err(|_| Error::Invalid("invalid Deepgram key".into()))?,
        );
        let (socket, _) = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(Error::Cancelled),
            result = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(request)) =>
                result.map_err(|_| Error::Protocol("Deepgram setup timed out".into()))?
                .map_err(|_| Error::Protocol("Deepgram handshake failed; check key and model".into()))?,
        };
        let (sink, stream) = socket.split();
        let input = FluxInput {
            sink: Mutex::new(Box::pin(
                sink.sink_map_err(|_| Error::Protocol("Deepgram write failed".into())),
            )),
            rate: self.sample_rate,
            cancellation: cancellation.clone(),
        };
        let events = stream
            .filter_map(|event| async move {
                match event {
                    Ok(WsMessage::Text(text)) => Some(
                        serde_json::from_str(&text)
                            .map_err(Error::from)
                            .and_then(decode_flux),
                    ),
                    Ok(WsMessage::Close(_)) => {
                        Some(Err(Error::Protocol("Deepgram connection closed".into())))
                    }
                    Err(_) => Some(Err(Error::Protocol("Deepgram receive failed".into()))),
                    _ => None,
                }
            })
            .take_until(cancellation.cancelled_owned())
            .boxed();
        Ok(TranscriptionSession {
            input: Arc::new(input),
            events,
        })
    }
}
type SpeechSink = std::pin::Pin<Box<dyn futures_util::Sink<WsMessage, Error = Error> + Send>>;
struct FluxInput {
    sink: Mutex<SpeechSink>,
    rate: u32,
    cancellation: CancellationToken,
}
impl FluxInput {
    async fn write(&self, message: WsMessage) -> Result<()> {
        let result = tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => return Err(Error::Cancelled),
            result = tokio::time::timeout(Duration::from_secs(5), async { self.sink.lock().await.send(message).await }) =>
                result.map_err(|_| Error::Protocol("Deepgram write timed out".into()))?,
        };
        if result.is_err() {
            self.cancellation.cancel();
        }
        result
    }
}
#[async_trait]
impl SpeechInput for FluxInput {
    async fn close(&self) -> Result<()> {
        let result = self.sink.lock().await.close().await;
        self.cancellation.cancel();
        result
    }
    fn sample_rate(&self) -> u32 {
        self.rate
    }
    async fn append(&self, frame: &PcmFrame) -> Result<()> {
        if frame.sample_rate != self.rate
            || frame.samples.is_empty()
            || frame.samples.len() > self.rate as usize
        {
            return Err(Error::Invalid("speech input requires nonempty PCM at the configured rate, at most one second per frame".into()));
        }
        self.write(WsMessage::Binary(frame.bytes().into())).await
    }
    async fn end_turn(&self) -> Result<()> {
        self.write(WsMessage::Text(
            json!({"type":"ForceEndTurn"}).to_string().into(),
        ))
        .await
    }
}
/// Kept separate from networking for protocol fixtures.
fn decode_flux(value: Value) -> Result<TranscriptionEvent> {
    if matches!(value["type"].as_str(), Some("Error" | "error")) {
        return Err(Error::Protocol(format!(
            "Deepgram: {}",
            value["description"]
                .as_str()
                .or(value["message"].as_str())
                .unwrap_or("transcription failed")
        )));
    }
    let event = value["event"].as_str().unwrap_or("");
    if matches!(event, "StartOfTurn" | "Update" | "EndOfTurn") {
        let id = value["turn_index"]
            .as_u64()
            .ok_or_else(|| Error::Protocol("Deepgram turn_index missing".into()))?
            .to_string();
        if event == "StartOfTurn" {
            return Ok(TranscriptionEvent::Started { id });
        }
        return Ok(TranscriptionEvent::Transcript {
            id,
            text: value["transcript"].as_str().unwrap_or("").into(),
            committed: event == "EndOfTurn",
        });
    }
    Ok(TranscriptionEvent::Observation { event: value })
}

#[async_trait]
pub trait SpeechOutput: Send + Sync {
    /// One bounded text segment. Streams PCM while the language model continues.
    async fn synthesize(
        &self,
        text: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>>;

    /// Optional original-text alignment. Times are relative to this synthesis
    /// request, byte offsets are UTF-8 boundaries in the supplied text.
    async fn synthesize_timed(
        &self,
        text: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<SpeechEvent>>> {
        Ok(self
            .synthesize(text, cancellation)
            .await?
            .map(|r| r.map(SpeechEvent::Audio))
            .boxed())
    }
}

#[derive(Clone, Debug)]
pub struct SpeechTiming {
    pub text_end: usize,
    pub end_ms: u64,
}
#[derive(Clone, Debug)]
pub enum SpeechEvent {
    Audio(PcmFrame),
    Timing(Vec<SpeechTiming>),
}
pub struct HttpSpeechOutput {
    pub speech: Speech,
    pub model: String,
    pub voice: String,
    pub elevenlabs: bool,
}
#[async_trait]
impl SpeechOutput for HttpSpeechOutput {
    async fn synthesize_timed(
        &self,
        text: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<SpeechEvent>>> {
        if self.elevenlabs {
            self.speech
                .speak_elevenlabs_timed(text, &self.model, &self.voice, 24000, cancellation)
                .await
        } else {
            Ok(self
                .synthesize(text, cancellation)
                .await?
                .map(|r| r.map(SpeechEvent::Audio))
                .boxed())
        }
    }
    async fn synthesize(
        &self,
        text: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>> {
        if self.elevenlabs {
            self.speech
                .speak_elevenlabs(text, &self.model, &self.voice, 24000, cancellation)
                .await
        } else {
            self.speech
                .speak(text, &self.model, &self.voice, cancellation)
                .await
        }
    }
}
pub struct DeepgramAura {
    pub speech: Speech,
    pub model: String,
}
#[async_trait]
impl SpeechOutput for DeepgramAura {
    async fn synthesize(
        &self,
        text: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>> {
        self.speech
            .speak_deepgram(text, &self.model, cancellation)
            .await
    }
}
/// A short audible tone per segment; deliberately does not pretend to synthesize speech.
pub struct MockSpeechOutput;
#[async_trait]
impl SpeechOutput for MockSpeechOutput {
    async fn synthesize(
        &self,
        _: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>> {
        crate::error::check_cancel(&cancellation)?;
        let samples = (0..4800)
            .map(|i| ((i as f32 * 440.0 * std::f32::consts::TAU / 24000.0).sin() * 1500.0) as i16)
            .collect();
        Ok(futures_util::stream::once(async {
            Ok(PcmFrame {
                samples,
                sample_rate: 24000,
            })
        })
        .boxed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flux_commits_only_end_of_turn_and_reports_errors() {
        for event in ["Update", "EagerEndOfTurn", "TurnResumed", "EndOfTurn"] {
            let decoded = decode_flux(
                json!({"type":"TurnInfo","event":event,"turn_index":7,"transcript":"hello"}),
            )
            .unwrap();
            assert_eq!(
                matches!(
                    decoded,
                    TranscriptionEvent::Transcript {
                        committed: true,
                        ..
                    }
                ),
                event == "EndOfTurn"
            );
        }
        assert!(decode_flux(json!({"type":"Error","description":"bad format"})).is_err());
    }
}
