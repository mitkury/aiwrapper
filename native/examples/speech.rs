//! Development bridge for recorded transcription and streamed synthesis.
use aiwrapper::{speech::*, *};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{Read, Write};

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case")]
enum Request {
    Transcribe {
        audio: String,
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
    },
    Speak {
        provider: String,
        text: String,
        model: String,
        voice: String,
    },
}
fn environment(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| fallback.into())
}
fn speech(prefix: &str, base: &str) -> Result<Speech> {
    let key = environment(&format!("{prefix}_API_KEY"), "");
    if key.is_empty() {
        return Err(Error::Invalid(format!(
            "{prefix}_API_KEY is not configured"
        )));
    }
    Speech::new(key, environment(&format!("{prefix}_BASE_URL"), base))
}
fn emit(value: Value) -> Result<()> {
    let mut output = std::io::stdout().lock();
    writeln!(output, "{value}")
        .and_then(|_| output.flush())
        .map_err(|e| Error::Protocol(e.to_string()))
}
#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        let _ = emit(json!({"done":true,"error":error.to_string()}));
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin()
        .take(34 * 1024 * 1024 + 1)
        .read_to_string(&mut input)
        .map_err(|e| Error::Invalid(e.to_string()))?;
    if input.len() > 34 * 1024 * 1024 {
        return Err(Error::Invalid("speech request exceeds 34 MiB".into()));
    }
    let cancellation = CancellationToken::new();
    match serde_json::from_str::<Request>(&input)? {
        Request::Transcribe { audio, sample_rate } => {
            let bytes = STANDARD
                .decode(audio)
                .map_err(|_| Error::Invalid("invalid audio base64".into()))?;
            if bytes.is_empty() || bytes.len() % 2 != 0 || bytes.len() > 24_000_000 {
                return Err(Error::Invalid(
                    "transcription requires 1–24 MB of signed 16-bit PCM".into(),
                ));
            }
            let frame = PcmFrame {
                samples: bytes
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| i16::from_le_bytes(*b))
                    .collect(),
                sample_rate,
            };
            let text = speech("OPENAI", "https://api.openai.com/v1")?
                .transcribe(
                    &frame,
                    &environment("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
                    None,
                    &cancellation,
                )
                .await?;
            emit(json!({"text":text,"done":true}))?;
        }
        Request::Speak {
            provider,
            text,
            model,
            voice,
        } => {
            if text.trim().is_empty() || text.chars().count() > 5000 {
                return Err(Error::Invalid(
                    "speech text requires 1–5000 characters".into(),
                ));
            }
            let mut frames = match provider.as_str() {
                "openai" => {
                    speech("OPENAI", "https://api.openai.com/v1")?
                        .speak(&text, &model, &voice, cancellation)
                        .await?
                }
                "elevenlabs" => {
                    speech("ELEVENLABS", "https://api.elevenlabs.io/v1")?
                        .speak_elevenlabs(&text, &model, &voice, 24000, cancellation)
                        .await?
                }
                _ => return Err(Error::Invalid("unsupported speech provider".into())),
            };
            while let Some(frame) = frames.next().await {
                let frame = frame?;
                // Bound each bridge message independently of provider chunk size.
                for samples in frame.samples.chunks(2400) {
                    emit(
                        json!({"audio":STANDARD.encode(PcmFrame {samples:samples.to_vec(),sample_rate:frame.sample_rate}.bytes()),"sampleRate":frame.sample_rate}),
                    )?;
                }
            }
            emit(json!({"done":true}))?;
        }
    }
    Ok(())
}
