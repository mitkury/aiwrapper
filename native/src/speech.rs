//! Batch transcription and PCM synthesis. Capture, resampling, playback and
//! realtime media transports belong to the host.
use crate::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::{StreamExt, stream::BoxStream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcmFrame {
    pub samples: Vec<i16>,
    pub sample_rate: u32,
}
impl PcmFrame {
    pub fn bytes(&self) -> Vec<u8> {
        self.samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }
    pub fn validate(&self) -> Result<()> {
        if !(8000..=192000).contains(&self.sample_rate) {
            return Err(Error::Invalid("invalid PCM sample rate".into()));
        }
        Ok(())
    }
    pub fn wav(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let bytes = self.bytes();
        let length =
            u32::try_from(bytes.len()).map_err(|_| Error::Invalid("audio too large".into()))?;
        let size = length
            .checked_add(36)
            .ok_or_else(|| Error::Invalid("audio too large".into()))?;
        let mut out = b"RIFF".to_vec();
        out.extend(size.to_le_bytes());
        out.extend(b"WAVEfmt ");
        out.extend(16u32.to_le_bytes());
        out.extend(1u16.to_le_bytes());
        out.extend(1u16.to_le_bytes());
        out.extend(self.sample_rate.to_le_bytes());
        out.extend((self.sample_rate * 2).to_le_bytes());
        out.extend(2u16.to_le_bytes());
        out.extend(16u16.to_le_bytes());
        out.extend(b"data");
        out.extend(length.to_le_bytes());
        out.extend(bytes);
        Ok(out)
    }
}

/// A transcript and the provider's usage report for it, when sent.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transcription {
    pub text: String,
    pub usage: Option<Value>,
}
pub struct Speech {
    transport: Arc<dyn HttpTransport>,
    pub api_key: String,
    pub base_url: String,
}
impl Speech {
    pub fn new(api_key: impl Into<String>, base_url: impl Into<String>) -> Result<Self> {
        Ok(Self::with_transport(
            api_key,
            base_url,
            Arc::new(ReqwestTransport::new()?),
        ))
    }
    pub fn with_transport(
        api_key: impl Into<String>,
        base_url: impl Into<String>,
        transport: Arc<dyn HttpTransport>,
    ) -> Self {
        Self {
            transport,
            api_key: api_key.into(),
            base_url: base_url.into(),
        }
    }
    async fn send(
        &self,
        path: &str,
        body: Vec<u8>,
        headers: BTreeMap<String, String>,
        cancellation: &CancellationToken,
    ) -> Result<HttpResponse> {
        let response = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(Error::Cancelled),
            response = self.transport.send(HttpRequest { url:format!("{}{path}",self.base_url.trim_end_matches('/')),body,headers }) => response?,
        };
        if !(200..300).contains(&response.status) {
            let status = response.status;
            let body = tokio::select! {
                _ = cancellation.cancelled() => return Err(Error::Cancelled),
                body = crate::transport::read_body(response,65536) => body?,
            };
            return Err(Error::Http {
                status,
                body: String::from_utf8_lossy(&body).into_owned(),
            });
        }
        Ok(response)
    }
    /// OpenAI-compatible file transcription; model and optional language are explicit.
    pub async fn transcribe(
        &self,
        audio: &PcmFrame,
        model: &str,
        language: Option<&str>,
        cancellation: &CancellationToken,
    ) -> Result<String> {
        if audio.samples.len() > 12_000_000 {
            return Err(Error::Invalid("transcription audio exceeds 24 MB".into()));
        }
        // Boundary has no user-controlled header values. Text fields remain body data.
        let boundary = "aiwrapper-native-wav-6f341b09";
        let mut body = Vec::new();
        for (name, value) in [("model", Some(model)), ("language", language)] {
            if let Some(value) = value {
                body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").bytes());
            }
        }
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n").bytes());
        body.extend(audio.wav()?);
        body.extend(format!("\r\n--{boundary}--\r\n").bytes());
        let headers = BTreeMap::from([
            ("authorization".into(), format!("Bearer {}", self.api_key)),
            (
                "content-type".into(),
                format!("multipart/form-data; boundary={boundary}"),
            ),
        ]);
        let response = self
            .send("/audio/transcriptions", body, headers, cancellation)
            .await?;
        let bytes = tokio::select! {
            _ = cancellation.cancelled() => return Err(Error::Cancelled),
            bytes = crate::transport::read_body(response,8*1024*1024) => bytes?,
        };
        let value: Value = serde_json::from_slice(&bytes)?;
        value["text"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| Error::Protocol("transcription text missing".into()))
    }
    /// Google Cloud Speech-to-Text synchronous recognition.
    pub async fn transcribe_google(
        &self,
        audio: &PcmFrame,
        language: &str,
        cancellation: &CancellationToken,
    ) -> Result<String> {
        audio.validate()?;
        if audio.samples.len() > audio.sample_rate as usize * 60 {
            return Err(Error::Invalid(
                "synchronous Google transcription is limited to 60 seconds".into(),
            ));
        }
        let body = json!({"config":{"encoding":"LINEAR16","sampleRateHertz":audio.sample_rate,"languageCode":language},"audio":{"content":STANDARD.encode(audio.bytes())}});
        let headers = BTreeMap::from([
            ("x-goog-api-key".into(), self.api_key.clone()),
            ("content-type".into(), "application/json".into()),
        ]);
        let response = self
            .send(
                "/speech:recognize",
                serde_json::to_vec(&body)?,
                headers,
                cancellation,
            )
            .await?;
        let bytes = tokio::select! {
            _ = cancellation.cancelled() => return Err(Error::Cancelled),
            bytes = crate::transport::read_body(response,8*1024*1024) => bytes?,
        };
        let value: Value = serde_json::from_slice(&bytes)?;
        Ok(value["results"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| r["alternatives"][0]["transcript"].as_str())
            .collect::<Vec<_>>()
            .join(" "))
    }
    /// Gemini file transcription. Accept the recorded encoding without a PCM
    /// conversion; dedicated transcription models return audioTranscription.
    pub async fn transcribe_gemini(
        &self,
        audio: &[u8],
        mime_type: &str,
        model: &str,
        cancellation: &CancellationToken,
    ) -> Result<String> {
        self.transcribe_gemini_with_usage(audio, mime_type, model, cancellation)
            .await
            .map(|transcription| transcription.text)
    }
    /// [`Self::transcribe_gemini`] with the response's `usageMetadata`.
    pub async fn transcribe_gemini_with_usage(
        &self,
        audio: &[u8],
        mime_type: &str,
        model: &str,
        cancellation: &CancellationToken,
    ) -> Result<Transcription> {
        if audio.is_empty() || audio.len() > 10 * 1024 * 1024 {
            return Err(Error::Invalid(
                "transcription requires 1 byte to 10 MiB of audio".into(),
            ));
        }
        let mime_type = mime_type.split(';').next().unwrap_or("");
        if !mime_type.starts_with("audio/")
            || !model
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
            || model.is_empty()
        {
            return Err(Error::Invalid(
                "invalid transcription MIME type or model".into(),
            ));
        }
        let body = json!({"contents":[{"role":"user","parts":[
            {"inlineData":{"mimeType":mime_type,"data":STANDARD.encode(audio)}},
            {"text":"Transcribe this audio verbatim. Reply with the transcript only."}
        ]}]});
        let response = self
            .send(
                &format!("/models/{model}:generateContent"),
                serde_json::to_vec(&body)?,
                BTreeMap::from([
                    ("x-goog-api-key".into(), self.api_key.clone()),
                    ("content-type".into(), "application/json".into()),
                ]),
                cancellation,
            )
            .await?;
        let bytes = tokio::select! {
            _ = cancellation.cancelled() => return Err(Error::Cancelled),
            bytes = crate::transport::read_body(response, 8*1024*1024) => bytes?,
        };
        let value: Value = serde_json::from_slice(&bytes)?;
        let parts = value["candidates"][0]["content"]["parts"]
            .as_array()
            .ok_or_else(|| Error::Protocol("transcription response did not include text".into()))?;
        let text = parts
            .iter()
            .filter_map(|part| {
                part["audioTranscription"]["text"]
                    .as_str()
                    .or(part["text"].as_str())
            })
            .collect::<String>()
            .trim()
            .into();
        Ok(Transcription {
            text,
            usage: value.get("usageMetadata").filter(|u| u.is_object()).cloned(),
        })
    }
    /// OpenAI PCM synthesis, mono 24 kHz. Drop the stream to cancel network I/O.
    pub async fn speak(
        &self,
        text: &str,
        model: &str,
        voice: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>> {
        let headers = BTreeMap::from([
            ("authorization".into(), format!("Bearer {}", self.api_key)),
            ("content-type".into(), "application/json".into()),
        ]);
        let body = json!({"model":model,"input":text,"voice":voice,"response_format":"pcm"});
        let response = self
            .send(
                "/audio/speech",
                serde_json::to_vec(&body)?,
                headers,
                &cancellation,
            )
            .await?;
        Ok(pcm_stream(response, 24000, cancellation))
    }
    pub async fn speak_elevenlabs(
        &self,
        text: &str,
        model: &str,
        voice: &str,
        sample_rate: u32,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>> {
        if ![8000, 16000, 22050, 24000, 44100, 48000].contains(&sample_rate)
            || !voice
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_')
            || voice.is_empty()
        {
            return Err(Error::Invalid(
                "invalid ElevenLabs voice or PCM rate".into(),
            ));
        }
        let headers = BTreeMap::from([
            ("xi-api-key".into(), self.api_key.clone()),
            ("content-type".into(), "application/json".into()),
        ]);
        let path = format!("/text-to-speech/{voice}/stream?output_format=pcm_{sample_rate}");
        let response = self
            .send(
                &path,
                serde_json::to_vec(&json!({"text":text,"model_id":model}))?,
                headers,
                &cancellation,
            )
            .await?;
        Ok(pcm_stream(response, sample_rate, cancellation))
    }
}
fn pcm_stream(
    response: HttpResponse,
    sample_rate: u32,
    cancellation: CancellationToken,
) -> BoxStream<'static, Result<PcmFrame>> {
    futures_util::stream::unfold((response.body,Vec::<u8>::new(),false,cancellation),move |(mut body,mut pending,done,cancel)| async move {
        if done { return None; }
        loop {
            let chunk = tokio::select! {
                biased;
                _ = cancel.cancelled() => return Some((Err(Error::Cancelled),(body,pending,true,cancel))),
                chunk = body.next() => chunk,
            };
            match chunk {
                Some(Ok(bytes)) => {
                    pending.extend(bytes);
                    let count = pending.len()/2*2;
                    if count == 0 { continue; }
                    let samples = pending[..count].chunks_exact(2).map(|b|i16::from_le_bytes([b[0],b[1]])).collect();
                    pending.drain(..count);
                    return Some((Ok(PcmFrame { samples,sample_rate }),(body,pending,false,cancel)));
                }
                Some(Err(error)) => return Some((Err(error),(body,pending,true,cancel))),
                None if !pending.is_empty() => return Some((Err(Error::Protocol("truncated PCM sample".into())),(body,pending,true,cancel))),
                None => return None,
            }
        }
    }).boxed()
}
