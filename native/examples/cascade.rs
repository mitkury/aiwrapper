//! Persistent development host: one process per browser session, bounded NDJSON I/O.
use aiwrapper::{live::*, speech::*, speech_stream::*, *};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    offline: bool,
    #[serde(default)]
    live: bool,
    #[serde(default)]
    microphone: bool,
    provider: Provider,
    model: String,
    stt_model: String,
    tts: String,
    tts_model: String,
    voice: String,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Command {
    Text { text: String },
    Audio { samples: Vec<i16> },
    Image { data: String, mime: String },
    Interrupt,
    Played { item: String, index: usize, ms: u64 },
    EndAudio,
    Close,
}
fn key(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| Error::Invalid(format!("{name} is not configured")))
}
async fn write(value: Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(&value)?;
    bytes.push(b'\n');
    tokio::io::stdout()
        .write_all(&bytes)
        .await
        .map_err(|e| Error::Protocol(e.to_string()))
}
async fn line(reader: &mut BufReader<tokio::io::Stdin>) -> Result<Option<String>> {
    let mut bytes = vec![];
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|e| Error::Protocol(e.to_string()))?;
        if available.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                Err(Error::Invalid("truncated host command".into()))
            };
        }
        let end = available.iter().position(|b| *b == b'\n');
        let count = end.map_or(available.len(), |i| i + 1);
        if bytes.len() + count > 3 * 1024 * 1024 {
            return Err(Error::Invalid("host command exceeds 3 MiB".into()));
        }
        bytes.extend_from_slice(&available[..count]);
        reader.consume(count);
        if end.is_some() {
            return String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| Error::Invalid("host command is not UTF-8".into()));
        }
    }
}
#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        let _ = write(json!({"type":"error","message":error.to_string()})).await;
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let mut reader = BufReader::new(tokio::io::stdin());
    let config: Config = serde_json::from_str(
        &line(&mut reader)
            .await?
            .ok_or_else(|| Error::Invalid("missing configuration".into()))?,
    )?;
    let cancel = CancellationToken::new();
    let tools = vec![
        Tool::new(
            "get_time",
            "Get the current Unix time",
            json!({"type":"object","properties":{},"additionalProperties":false}),
            |_, _| async {
                Ok(
                    json!({"unixSeconds":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()}),
                )
            },
        ),
        Tool::new(
            "add",
            "Add two numbers",
            json!({"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"],"additionalProperties":false}),
            |v, _| async move { Ok(json!(v["a"].as_f64().unwrap() + v["b"].as_f64().unwrap())) },
        ),
    ];
    let live = config.live;
    let session = connect(config, &tools, cancel.clone()).await?;
    let input_sample_rate = session.sender.input_sample_rate();
    if live {
        write(json!({"type":"model","event":{"type":"provider-state","state":{"kind":"connected","runtime":"rust","inputSampleRate":input_sample_rate}}})).await?;
    }
    let mut agent = LiveAgent::new(session, tools, Default::default())?;
    let sender = agent.sender();
    // Input has its own task: waiting for a command reply must not stop event polling.
    let input = tokio::spawn(async move {
        loop {
            let Some(text) = line(&mut reader).await? else {
                break;
            };
            let command: Command = serde_json::from_str(&text)?;
            let result = match command {
                Command::Text { text } => sender.send_realtime_text(&text).await,
                Command::Audio { samples } => {
                    sender
                        .append_audio(&PcmFrame {
                            samples,
                            sample_rate: input_sample_rate,
                        })
                        .await
                }
                Command::Image { data, mime } => sender.append_image(&data, &mime).await,
                Command::Interrupt => sender.interrupt().await,
                Command::Played { item, index, ms } => {
                    sender.truncate_audio(&item, index, ms).await
                }
                Command::EndAudio => sender.end_audio().await,
                Command::Close => break,
            };
            // A malformed command terminates this development session explicitly.
            result?;
        }
        Ok::<(), Error>(())
    });
    let mut input = input;
    let result=async {
        loop {
            tokio::select! {
                biased;
                result=&mut input=>return result.map_err(|_|Error::Protocol("host input task failed".into()))?,
                events=agent.next_events()=>match events? {
                    Some(events)=>for event in events {tokio::time::timeout(Duration::from_secs(5),write(serde_json::to_value(event)?)).await.map_err(|_|Error::Protocol("browser stopped reading events".into()))??;},
                    None=>return Ok(()),
                },
                _=tokio::time::sleep(Duration::from_secs(1800))=>return Err(Error::Protocol("session idle timeout".into())),
            }
        }
    }.await;
    input.abort();
    cancel.cancel();
    let _ = tokio::time::timeout(Duration::from_secs(3), agent.close()).await;
    result
}

async fn connect(config: Config, tools: &[Tool], cancel: CancellationToken) -> Result<LiveSession> {
    if config.live {
        if config.offline {
            return Err(Error::Invalid(
                "native live models require provider access".into(),
            ));
        }
        let (provider, credential) = match config.provider {
            Provider::Openai => (LiveProvider::Openai, "OPENAI_API_KEY"),
            Provider::Google => (LiveProvider::Google, "GOOGLE_API_KEY"),
            _ => {
                return Err(Error::Invalid(
                    "Rust live voice supports OpenAI and Google".into(),
                ));
            }
        };
        let mut live = LiveConfig::new(provider, config.model, key(credential)?);
        live.voice = config.voice;
        live.instructions = "You are a concise voice assistant. Keep spoken replies short and use tools when needed.".into();
        live.tools = tools.iter().map(|t| t.definition.clone()).collect();
        live.cancellation = cancel;
        if let Ok(endpoint) = std::env::var("AIWRAPPER_LIVE_ENDPOINT") {
            live.endpoint = endpoint;
        }
        return live.connect().await;
    }
    let language: Arc<dyn LanguageProvider> = if config.offline {
        Arc::new(MockLang::interactive())
    } else {
        let prefix = config.provider.as_str().replace('-', "_").to_uppercase();
        let mut provider = ProviderConfig::new(config.provider, config.model);
        if config.provider != Provider::Ollama {
            provider.api_key = Some(key(&format!("{prefix}_API_KEY"))?);
        }
        if let Ok(url) = std::env::var(format!("{prefix}_BASE_URL"))
            && !url.trim().is_empty()
        {
            provider.base_url = url;
        }
        Arc::new(Lang::new(provider)?)
    };
    let speech: Arc<dyn SpeechOutput> = if config.offline {
        Arc::new(MockSpeechOutput)
    } else {
        let elevenlabs = config.tts == "elevenlabs";
        let (credential, url) = if elevenlabs {
            ("ELEVENLABS_API_KEY", "https://api.elevenlabs.io/v1")
        } else {
            ("OPENAI_API_KEY", "https://api.openai.com/v1")
        };
        let voice = if elevenlabs && config.voice.trim().is_empty() {
            key("ELEVENLABS_VOICE_ID")?
        } else {
            config.voice
        };
        Arc::new(HttpSpeechOutput {
            speech: Speech::new(key(credential)?, url)?,
            model: config.tts_model,
            voice,
            elevenlabs,
        })
    };
    let mut cascade = CascadeConfig::new(language, speech);
    cascade.cancellation = cancel.clone();
    cascade.conversation.instructions="You are a concise voice assistant. Answer in the user's language. Keep replies short, use the latest image when relevant, and call tools when needed.".into();
    cascade.tools = tools.iter().map(|t| t.definition.clone()).collect();
    if !config.offline && config.microphone {
        cascade.transcription = Some(
            DeepgramFlux {
                api_key: key("DEEPGRAM_API_KEY")?,
                model: config.stt_model,
                sample_rate: 24000,
            }
            .connect(cancel.child_token())
            .await?,
        );
    }
    cascade.connect()
}
