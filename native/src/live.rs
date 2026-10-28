//! Duplex live model sessions. Hosts own WebRTC, tool execution, reconnects,
//! playback cursors and durable history. Split send/receive halves allow audio
//! to flow while tools execute on another task.
use crate::{speech::PcmFrame, *};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::{Sink, SinkExt, StreamExt, stream::BoxStream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    pin::Pin,
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Mutex, Notify};
use tokio_tungstenite::tungstenite::{Message as WsMessage, client::IntoClientRequest};

#[path = "live-agent.rs"]
mod agent;
pub use agent::*;

type JsonSink = Pin<Box<dyn Sink<Value, Error = Error> + Send>>;
pub struct LiveSocket {
    pub sender: JsonSink,
    pub receiver: BoxStream<'static, Result<Value>>,
}
#[async_trait]
pub trait LiveTransport: Send + Sync {
    async fn connect(&self, url: String, headers: BTreeMap<String, String>) -> Result<LiveSocket>;
}
pub struct WebSocketTransport;
#[async_trait]
impl LiveTransport for WebSocketTransport {
    async fn connect(&self, url: String, headers: BTreeMap<String, String>) -> Result<LiveSocket> {
        let mut request = url
            .into_client_request()
            .map_err(|_| Error::Invalid("invalid WebSocket URL".into()))?;
        for (name, value) in headers {
            request.headers_mut().insert(
                tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| Error::Invalid("invalid WebSocket header".into()))?,
                value
                    .parse()
                    .map_err(|_| Error::Invalid("invalid WebSocket header value".into()))?,
            );
        }
        // Do not include the URL in errors: some protocols put credentials in its query.
        let (socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|_| Error::Protocol("WebSocket handshake failed".into()))?;
        let (sender, receiver) = socket.split();
        let sender = sender
            .sink_map_err(|_| Error::Protocol("WebSocket send failed".into()))
            .with(|value: Value| {
                futures_util::future::ready(Ok::<_, Error>(WsMessage::Text(
                    value.to_string().into(),
                )))
            });
        let receiver = receiver.filter_map(|message| async move {
            match message {
                Ok(WsMessage::Text(text)) => Some(serde_json::from_str(&text).map_err(Error::from)),
                Ok(WsMessage::Binary(bytes)) => Some(serde_json::from_slice(&bytes).map_err(Error::from)),
                Ok(WsMessage::Close(frame)) => Some(Ok(json!({"__closed":true,"code":frame.as_ref().map(|f|u16::from(f.code)),"reason":frame.map(|f|f.reason.to_string())}))),
                Ok(_) => None,
                Err(_) => Some(Err(Error::Protocol("WebSocket receive failed".into()))),
            }
        });
        Ok(LiveSocket {
            sender: Box::pin(sender),
            receiver: receiver.boxed(),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiveProvider {
    Google,
    Openai,
}
pub struct LiveConfig {
    pub provider: LiveProvider,
    pub model: String,
    pub api_key: String,
    pub voice: String,
    /// Full WebSocket endpoint, without a key or model query parameter.
    pub endpoint: String,
    pub instructions: String,
    pub tools: Vec<ToolDefinition>,
    /// Additional setup/session fields; provider-specific controls stay at the edge.
    pub settings: BTreeMap<String, Value>,
    pub headers: BTreeMap<String, String>,
    pub cancellation: CancellationToken,
    pub connect_timeout: Duration,
    /// Restore only state exported from the same Gemini resumption handle.
    pub resumption: Option<LiveResumption>,
    /// Gemini Live short-lived auth token, sent as access_token instead of key.
    pub ephemeral: bool,
}
impl LiveConfig {
    pub fn new(
        provider: LiveProvider,
        model: impl Into<String>,
        api_key: impl Into<String>,
    ) -> Self {
        Self { provider,model:model.into(),api_key:api_key.into(),voice:if provider == LiveProvider::Google {"Kore"} else {"marin"}.into(),
            endpoint:if provider == LiveProvider::Google {"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"} else {"wss://api.openai.com/v1/realtime"}.into(),
            instructions:String::new(),tools:vec![],settings:BTreeMap::new(),headers:BTreeMap::new(),cancellation:CancellationToken::new(),connect_timeout:Duration::from_secs(15),resumption:None,ephemeral:false }
    }
    pub async fn connect(self) -> Result<LiveSession> {
        self.connect_with(&WebSocketTransport).await
    }
    pub async fn connect_with(mut self, transport: &dyn LiveTransport) -> Result<LiveSession> {
        self.cancellation = self.cancellation.child_token();
        if self.model.trim().is_empty() {
            return Err(Error::Invalid("live model is required".into()));
        }
        let mut url = reqwest::Url::parse(&self.endpoint)
            .map_err(|_| Error::Invalid("invalid live endpoint".into()))?;
        if !matches!(url.scheme(), "ws" | "wss") {
            return Err(Error::Invalid("live endpoint must be ws or wss".into()));
        }
        let resumed_calls = match self.resumption {
            Some(resumption)
                if self.provider == LiveProvider::Google
                    && self
                        .settings
                        .get("sessionResumption")
                        .and_then(|v| v["handle"].as_str())
                        == Some(resumption.handle.as_str()) =>
            {
                resumption.calls
            }
            Some(_) => {
                return Err(Error::Invalid(
                    "resumption state requires its original Gemini handle".into(),
                ));
            }
            None => BTreeMap::new(),
        };
        if self.ephemeral && self.provider != LiveProvider::Google {
            return Err(Error::Invalid(
                "ephemeral mode applies only to Gemini; OpenAI uses bearer credentials".into(),
            ));
        }
        if self.ephemeral
            && url.host_str() == Some("generativelanguage.googleapis.com")
            && url.path().ends_with(".BidiGenerateContent")
        {
            url.set_path(&format!("{}Constrained", url.path()));
        }
        let initial_handle = self
            .settings
            .get("sessionResumption")
            .and_then(|v| v["handle"].as_str())
            .map(str::to_owned);
        let mut headers = self.headers;
        if self.provider == LiveProvider::Google {
            url.query_pairs_mut().append_pair(
                if self.ephemeral {
                    "access_token"
                } else {
                    "key"
                },
                &self.api_key,
            );
        } else {
            url.query_pairs_mut().append_pair("model", &self.model);
            headers.insert("authorization".into(), format!("Bearer {}", self.api_key));
        }
        let setup = if self.provider == LiveProvider::Google {
            let tools: Vec<_> = self.tools.iter().map(|t|json!({"name":t.name,"description":t.description,"parametersJsonSchema":t.parameters})).collect();
            let mut setup = json!({"model":format!("models/{}",self.model.trim_start_matches("models/")),
                "generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":self.voice}}}},
                "systemInstruction":{"parts":[{"text":self.instructions}]},"inputAudioTranscription":{},"outputAudioTranscription":{}});
            if !tools.is_empty() {
                setup["tools"] = json!([{"functionDeclarations":tools}]);
            }
            for (key, value) in self.settings {
                setup[key] = value;
            }
            json!({"setup":setup})
        } else {
            let tools: Vec<_> = self.tools.iter().map(|t|json!({"type":"function","name":t.name,"description":t.description,"parameters":t.parameters})).collect();
            let mut session = json!({"type":"realtime","output_modalities":["audio"],"instructions":self.instructions,
                "tools":tools,"audio":{"input":{"format":{"type":"audio/pcm","rate":24000},"transcription":{"model":"gpt-4o-mini-transcribe"},
                    "turn_detection":{"type":"server_vad","create_response":true,"interrupt_response":true}},
                    "output":{"format":{"type":"audio/pcm","rate":24000},"voice":self.voice}}});
            for (key, value) in self.settings {
                session[key] = value;
            }
            json!({"type":"session.update","session":session})
        };
        let model = self.model.trim_start_matches("models/").to_string();
        let transcription_model = setup["session"]["audio"]["input"]["transcription"]["model"]
            .as_str()
            .map(str::to_owned);
        let operation = async {
            let mut socket = transport.connect(url.to_string(), headers).await?;
            socket.sender.send(setup).await?;
            let mut queued = VecDeque::new();
            loop {
                let value = socket.receiver.next().await.ok_or_else(|| {
                    Error::Protocol("live connection closed before setup acknowledgement".into())
                })??;
                if let Some(error) = value.get("error") {
                    return Err(Error::Protocol(error.to_string()));
                }
                if value["__closed"] == true {
                    return Err(Error::Protocol(
                        "live connection closed before setup acknowledgement".into(),
                    ));
                }
                if value.get("setupComplete").is_some() || value["type"] == "session.updated" {
                    break;
                }
                if queued.len() >= 128 {
                    return Err(Error::Protocol(
                        "too many events before setup acknowledgement".into(),
                    ));
                }
                queued.push_back(value);
            }
            let connection = Arc::new(LiveConnection {
                resumed_from: initial_handle.clone(),
                state: Mutex::new(LiveState {
                    sender: Some(socket.sender),
                    phase: ResponsePhase::Idle,
                    interrupted: false,
                    pending_response: false,
                    has_tools: false,
                    calls: resumed_calls,
                    resume_handle: initial_handle,
                    events: VecDeque::new(),
                    closed: false,
                    model,
                    transcription_model,
                }),
                cancellation: self.cancellation.clone(),
                changed: Notify::new(),
            });
            let sender = LiveSender {
                provider: self.provider,
                connection: connection.clone(),
            };
            let receiver = LiveReceiver {
                provider: self.provider,
                receiver: socket.receiver,
                connection,
                queued,
                processing: None,
            };
            Ok(LiveSession {
                sender,
                receiver,
                tools: self.tools,
            })
        };
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(Error::Cancelled),
            result = tokio::time::timeout(self.connect_timeout,operation) => result.map_err(|_|Error::Protocol("live setup timed out".into()))?,
        }
    }
}

pub struct LiveSession {
    pub sender: LiveSender,
    pub receiver: LiveReceiver,
    tools: Vec<ToolDefinition>,
}
#[derive(Clone)]
pub struct LiveSender {
    provider: LiveProvider,
    connection: Arc<LiveConnection>,
}
impl LiveSender {
    pub fn input_sample_rate(&self) -> u32 {
        if self.provider == LiveProvider::Google {
            16000
        } else {
            24000
        }
    }
    async fn send(&self, value: Value) -> Result<()> {
        self.connection
            .state
            .lock()
            .await
            .send(value, &self.connection.cancellation)
            .await
    }
    pub async fn append_audio(&self, frame: &PcmFrame) -> Result<()> {
        frame.validate()?;
        if frame.sample_rate != self.input_sample_rate() {
            return Err(Error::Invalid(format!(
                "live input requires {} Hz mono PCM",
                self.input_sample_rate()
            )));
        }
        if frame.samples.is_empty() {
            return Ok(());
        }
        let data = STANDARD.encode(frame.bytes());
        self.send(if self.provider == LiveProvider::Google {
            json!({"realtimeInput":{"audio":{"data":data,"mimeType":"audio/pcm;rate=16000"}}})
        } else {
            json!({"type":"input_audio_buffer.append","audio":data})
        })
        .await
    }
    pub async fn end_audio(&self) -> Result<()> {
        self.send(if self.provider == LiveProvider::Google {
            json!({"realtimeInput":{"audioStreamEnd":true}})
        } else {
            json!({"type":"input_audio_buffer.commit"})
        })
        .await
    }
    pub async fn send_text(&self, text: &str, role: Role, turn_complete: bool) -> Result<()> {
        if role == Role::ToolResults {
            return Err(Error::Invalid(
                "send_text requires user or assistant role".into(),
            ));
        }
        if self.provider == LiveProvider::Google {
            self.send(json!({"clientContent":{"turns":[{"role":if role==Role::Assistant {"model"} else {"user"},"parts":[{"text":text}]}],"turnComplete":turn_complete}})).await
        } else {
            let mut state = self.connection.state.lock().await;
            state.send(json!({"type":"conversation.item.create","item":{"type":"message","role":if role==Role::Assistant {"assistant"} else {"user"},"content":[{"type":if role==Role::Assistant {"output_text"} else {"input_text"},"text":text}]}}), &self.connection.cancellation).await?;
            if turn_complete {
                state.pending_response = true;
                state.interrupt(true, &self.connection.cancellation).await?;
                state
                    .continue_response(&self.connection.cancellation)
                    .await?;
                self.connection.changed.notify_one();
            }
            Ok(())
        }
    }
    /// User activity input; silent context uses send_text(..., false) instead.
    pub async fn send_realtime_text(&self, text: &str) -> Result<()> {
        if self.provider == LiveProvider::Google {
            self.send(json!({"realtimeInput":{"text":text}})).await
        } else {
            self.send_text(text, Role::User, true).await
        }
    }
    pub async fn resumption(&self) -> Option<LiveResumption> {
        let state = self.connection.state.lock().await;
        state.resume_handle.as_ref().map(|handle| LiveResumption {
            handle: handle.clone(),
            calls: state
                .calls
                .iter()
                .filter(|(_, call)| !matches!(call, ToolState::Sent))
                .map(|(id, call)| (id.clone(), call.clone()))
                .collect(),
        })
    }
    pub async fn append_image(&self, data: &str, mime: &str) -> Result<()> {
        if !matches!(mime, "image/jpeg" | "image/png") {
            return Err(Error::Invalid("live image must be JPEG or PNG".into()));
        }
        self.send(if self.provider == LiveProvider::Google {json!({"realtimeInput":{"video":{"data":data,"mimeType":mime}}})}
            else {json!({"type":"conversation.item.create","item":{"type":"message","role":"user","content":[{"type":"input_image","image_url":format!("data:{mime};base64,{data}")}]}})}).await
    }
    pub async fn send_tool_results(&self, results: &[LiveToolResult]) -> Result<()> {
        for result in results {
            if result.call_id.is_empty() || result.name.is_empty() {
                return Err(Error::Invalid(
                    "live tool result requires a call id and name".into(),
                ));
            }
            for image in &result.images {
                image.validate()?;
            }
            if result.result["type"] == "tool-content" {
                return Err(Error::Unsupported(
                    "live results use JSON and an images list, not the text tool-content envelope"
                        .into(),
                ));
            }
        }
        let mut state = self.connection.state.lock().await;
        crate::error::check_cancel(&self.connection.cancellation)?;
        // Validate the whole batch before writing anything, including across sender clones.
        let mut ids = HashSet::new();
        for result in results {
            if !ids.insert(&result.call_id) {
                return Err(Error::Invalid("duplicate live tool result in batch".into()));
            }
            match state.calls.get(&result.call_id) {
                Some(ToolState::Cancelled) => continue,
                Some(ToolState::Pending(name)) if name == &result.name => {}
                _ => {
                    return Err(Error::Invalid(
                        "live tool result must match a pending call id and name".into(),
                    ));
                }
            }
        }
        let active: Vec<_> = results
            .iter()
            .filter(|r| !matches!(state.calls.get(&r.call_id), Some(ToolState::Cancelled)))
            .collect();
        if active.is_empty() {
            return Ok(());
        }
        if self.provider == LiveProvider::Google {
            let responses: Vec<_> = active.iter().map(|r| {
                let mut response = json!({"id":r.call_id,"name":r.name,"response":if r.result.is_object() {r.result.clone()} else {json!({"result":r.result})}});
                if !r.images.is_empty() {
                    response["parts"] = json!(r.images.iter().map(|image| json!({"inlineData":{"mimeType":image.mime_type,"data":image.data}})).collect::<Vec<_>>());
                }
                response
            }).collect();
            state
                .send(
                    json!({"toolResponse":{"functionResponses":responses}}),
                    &self.connection.cancellation,
                )
                .await?;
        } else {
            for r in &active {
                state.send(json!({"type":"conversation.item.create","item":{"type":"function_call_output","call_id":r.call_id,"output":r.result.to_string()}}), &self.connection.cancellation).await?;
                if !r.images.is_empty() {
                    state.send(json!({"type":"conversation.item.create","item":{"type":"message","role":"user","content":r.images.iter().map(|image| json!({"type":"input_image","image_url":format!("data:{};base64,{}",image.mime_type,image.data)})).collect::<Vec<_>>()}}), &self.connection.cancellation).await?;
                }
            }
        }
        for result in active {
            state.calls.insert(result.call_id.clone(), ToolState::Sent);
        }
        if self.provider == LiveProvider::Openai {
            state
                .continue_response(&self.connection.cancellation)
                .await?;
        }
        Ok(())
    }
    pub async fn interrupt(&self) -> Result<()> {
        if self.provider == LiveProvider::Google {
            return Err(Error::Unsupported(
                "Gemini interruptions follow input activity detection".into(),
            ));
        }
        let mut state = self.connection.state.lock().await;
        crate::error::check_cancel(&self.connection.cancellation)?;
        state.pending_response = false;
        state.interrupt(true, &self.connection.cancellation).await?;
        self.connection.changed.notify_one();
        Ok(())
    }
    pub async fn truncate_audio(
        &self,
        item_id: &str,
        content_index: usize,
        played_ms: u64,
    ) -> Result<()> {
        if self.provider == LiveProvider::Google {
            return Err(Error::Unsupported(
                "Gemini does not expose audio truncation".into(),
            ));
        }
        self.send(json!({"type":"conversation.item.truncate","item_id":item_id,"content_index":content_index,"audio_end_ms":played_ms})).await
    }
    pub async fn close(&self) -> Result<()> {
        // Wake blocked readers/writers before waiting for the transport's close handshake.
        self.connection.cancellation.cancel();
        let result = tokio::time::timeout(Duration::from_secs(2), async {
            let mut state = self.connection.state.lock().await;
            state.closed = true;
            state.events.clear();
            // Failed or cancelled writes consume the sink. Many Sink adapters
            // cannot be polled again after an error, including for close.
            match state.sender.take() {
                Some(mut sender) => sender.close().await,
                None => Ok(()),
            }
        })
        .await;
        result.map_err(|_| Error::Protocol("WebSocket close timed out".into()))?
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveToolResult {
    pub call_id: String,
    pub name: String,
    pub result: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<LiveImage>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveImage {
    pub data: String,
    pub mime_type: String,
}
impl LiveImage {
    fn validate(&self) -> Result<()> {
        if !matches!(self.mime_type.as_str(), "image/jpeg" | "image/png")
            || self.data.is_empty()
            || STANDARD.decode(&self.data).is_err()
        {
            return Err(Error::Invalid(
                "live image requires base64 JPEG or PNG data".into(),
            ));
        }
        Ok(())
    }
}
/// Opaque replay state exported by a sender. A fresh connection cannot import it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LiveResumption {
    handle: String,
    calls: BTreeMap<String, ToolState>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum LiveEvent {
    Audio {
        frame: PcmFrame,
        item_id: Option<String>,
        content_index: Option<usize>,
    },
    Transcript {
        input: bool,
        text: String,
        final_result: bool,
        id: Option<String>,
        text_output: bool,
    },
    SpeechStarted {
        id: Option<String>,
    },
    TranscriptionFailed {
        id: Option<String>,
        error: Value,
    },
    ResponseStarted,
    ResponseEnded,
    Interrupted,
    ToolCall {
        call_id: String,
        name: String,
        arguments: Value,
    },
    ToolsCancelled {
        call_ids: Vec<String>,
    },
    Resumption {
        resumable: bool,
        handle: Option<String>,
    },
    Expiring {
        time_left: Value,
    },
    ProviderState {
        state: Value,
    },
    /// Provider-reported usage, as sent: Gemini `usageMetadata` (one per billed
    /// turn) or an OpenAI `response.usage` / input transcription `usage`.
    /// `model` is the model the provider bills it to.
    Usage {
        model: String,
        usage: Value,
    },
    Closed {
        code: Option<u16>,
        reason: Option<String>,
    },
}
// One lock orders state changes with socket writes. There is no background task:
// the host must keep polling the receiver while sending input and running tools.
struct LiveConnection {
    resumed_from: Option<String>,
    state: Mutex<LiveState>,
    cancellation: CancellationToken,
    changed: Notify,
}
#[derive(PartialEq, Eq)]
enum ResponsePhase {
    Idle,
    Requested,
    Active,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
enum ToolState {
    Pending(String),
    Sent,
    Cancelled,
}
struct LiveState {
    sender: Option<JsonSink>,
    phase: ResponsePhase,
    interrupted: bool,
    pending_response: bool,
    has_tools: bool,
    calls: BTreeMap<String, ToolState>,
    resume_handle: Option<String>,
    events: VecDeque<LiveEvent>,
    closed: bool,
    model: String,
    transcription_model: Option<String>,
}
pub struct LiveReceiver {
    provider: LiveProvider,
    receiver: BoxStream<'static, Result<Value>>,
    connection: Arc<LiveConnection>,
    queued: VecDeque<Value>,
    // Retain a consumed message while waiting for a concurrent send or provider
    // continuation. Cancelling a poll must not discard part of the protocol.
    processing: Option<tokio::task::JoinHandle<Result<()>>>,
}
impl LiveReceiver {
    /// Drain the normalized events from one provider message as an ordered batch.
    /// Useful when an application forwards events across a process boundary and
    /// needs to preserve tool batches and transcript/response boundaries.
    pub async fn next_events(&mut self) -> Result<Option<Vec<LiveEvent>>> {
        self.receive(true).await
    }
    async fn drain_received(&mut self) -> Result<Vec<LiveEvent>> {
        if let Some(processing) = &mut self.processing {
            let result = processing.await;
            self.processing = None;
            result
                .map_err(|error| Error::Protocol(format!("live receive task failed: {error}")))??;
        }
        Ok(self
            .connection
            .state
            .lock()
            .await
            .events
            .drain(..)
            .collect())
    }
    pub async fn next_event(&mut self) -> Result<Option<LiveEvent>> {
        Ok(self
            .receive(false)
            .await?
            .and_then(|mut events| events.pop()))
    }
    async fn receive(&mut self, batch: bool) -> Result<Option<Vec<LiveEvent>>> {
        loop {
            if let Some(processing) = &mut self.processing {
                let result = processing.await;
                self.processing = None;
                result.map_err(|error| {
                    Error::Protocol(format!("live receive task failed: {error}"))
                })??;
            }
            {
                let mut state = self.connection.state.lock().await;
                if !state.closed {
                    crate::error::check_cancel(&self.connection.cancellation)?;
                }
                if !state.events.is_empty() {
                    // Remove and return under one lock, with no intervening
                    // await after consuming an event.
                    let count = if batch { state.events.len() } else { 1 };
                    return Ok(Some(state.events.drain(..count).collect()));
                }
                if state.closed {
                    return Ok(None);
                }
            }
            let value = if let Some(value) = self.queued.pop_front() {
                Ok(value)
            } else {
                tokio::select! {
                    biased;
                    _ = self.connection.cancellation.cancelled() => continue,
                    _ = self.connection.changed.notified() => continue,
                    value = self.receiver.next() => value.unwrap_or_else(|| Ok(json!({"__closed":true}))),
                }
            };
            let connection = self.connection.clone();
            let provider = self.provider;
            self.processing = Some(tokio::spawn(async move {
                let mut state = connection.state.lock().await;
                let result = async {
                    crate::error::check_cancel(&connection.cancellation)?;
                    let value = value?;
                    if let Some(error) = value.get("error").filter(|_| {
                        provider != LiveProvider::Openai
                            || value["type"] != "conversation.item.input_audio_transcription.failed"
                    }) {
                        // A response may end while cancellation is in flight.
                        if provider == LiveProvider::Openai
                            && error["code"] == "response_cancel_not_active"
                        {
                            return Ok(());
                        }
                        return Err(Error::Protocol(error.to_string()));
                    }
                    if value["__closed"] == true {
                        state.closed = true;
                        connection.cancellation.cancel();
                        state.events.push_back(LiveEvent::Closed {
                            code: value["code"].as_u64().and_then(|v| v.try_into().ok()),
                            reason: value["reason"].as_str().map(str::to_owned),
                        });
                        Ok(())
                    } else if provider == LiveProvider::Google {
                        state.google(value)
                    } else {
                        state.openai(value, &connection.cancellation).await
                    }
                }
                .await;
                if result.is_err() {
                    connection.cancellation.cancel();
                    state.closed = true;
                    state.events.clear();
                }
                result
            }));
        }
    }
}

impl Drop for LiveReceiver {
    fn drop(&mut self) {
        self.connection.cancellation.cancel();
        if let Some(processing) = self.processing.take() {
            processing.abort();
        }
    }
}

impl LiveState {
    async fn send(&mut self, value: Value, cancellation: &CancellationToken) -> Result<()> {
        crate::error::check_cancel(cancellation)?;
        let mut sender = self
            .sender
            .take()
            .ok_or_else(|| Error::Protocol("live connection is closed".into()))?;
        // A host may drop this future on its own deadline. Keep the connection
        // closed unless the entire write succeeds, and wake the receiver on drop.
        self.closed = true;
        let guard = cancellation.clone().drop_guard();
        let result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(Error::Cancelled),
            result = sender.send(value) => result,
        };
        if result.is_ok() {
            self.sender = Some(sender);
            self.closed = false;
            guard.disarm();
        } else {
            self.events.clear();
        }
        result
    }
    async fn continue_response(&mut self, cancellation: &CancellationToken) -> Result<()> {
        let tools_ready = self.has_tools
            && !self.interrupted
            && !self
                .calls
                .values()
                .any(|call| matches!(call, ToolState::Pending(_)));
        if self.phase == ResponsePhase::Idle && (self.pending_response || tools_ready) {
            self.send(json!({"type":"response.create"}), cancellation)
                .await?;
            self.phase = ResponsePhase::Requested;
            self.pending_response = false;
            self.has_tools = false;
            self.interrupted = false;
        }
        Ok(())
    }
    fn cancel_tools(&mut self) {
        let mut ids = Vec::new();
        for (id, call) in &mut self.calls {
            if matches!(call, ToolState::Pending(_)) {
                *call = ToolState::Cancelled;
                ids.push(id.clone());
            }
        }
        if !ids.is_empty() {
            self.events
                .push_back(LiveEvent::ToolsCancelled { call_ids: ids });
        }
    }
    async fn interrupt(
        &mut self,
        send_cancel: bool,
        cancellation: &CancellationToken,
    ) -> Result<()> {
        if self.interrupted || (self.phase == ResponsePhase::Idle && !self.has_tools) {
            return Ok(());
        }
        self.interrupted = true;
        self.has_tools = false;
        self.events.retain(|event| {
            !matches!(
                event,
                LiveEvent::Audio { .. }
                    | LiveEvent::Transcript { input: false, .. }
                    | LiveEvent::ToolCall { .. }
            )
        });
        self.events.push_back(LiveEvent::Interrupted);
        self.cancel_tools();
        if send_cancel && self.phase != ResponsePhase::Idle {
            self.send(json!({"type":"response.cancel"}), cancellation)
                .await?;
        }
        Ok(())
    }
    fn audio(&mut self, data: &str, value: &Value) -> Result<()> {
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| Error::Protocol("invalid base64 audio".into()))?;
        if bytes.len() % 2 != 0 {
            return Err(Error::Protocol("incomplete live PCM sample".into()));
        }
        self.events.push_back(LiveEvent::Audio {
            frame: PcmFrame {
                samples: bytes
                    .chunks_exact(2)
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
                    .collect(),
                sample_rate: 24000,
            },
            item_id: value["item_id"].as_str().map(str::to_owned),
            content_index: value["content_index"].as_u64().map(|v| v as usize),
        });
        Ok(())
    }
    fn call(&mut self, id: &str, name: &str, arguments: Value) -> Result<()> {
        if id.is_empty() || name.is_empty() || !arguments.is_object() {
            return Err(Error::Protocol("malformed live tool call".into()));
        }
        if !self.calls.contains_key(id) {
            self.calls
                .insert(id.into(), ToolState::Pending(name.into()));
            self.has_tools = true;
            self.events.push_back(LiveEvent::ToolCall {
                call_id: id.into(),
                name: name.into(),
                arguments,
            });
        }
        Ok(())
    }
    fn google(&mut self, value: Value) -> Result<()> {
        if let Some(update) = value.get("sessionResumptionUpdate") {
            self.resume_handle = if update["resumable"] == true {
                update["newHandle"]
                    .as_str()
                    .filter(|h| !h.is_empty())
                    .map(str::to_owned)
                    .or(self.resume_handle.take())
            } else {
                None
            };
            self.events.push_back(LiveEvent::Resumption {
                resumable: update["resumable"] == true,
                handle: update["newHandle"].as_str().map(str::to_owned),
            });
        }
        if let Some(go) = value.get("goAway") {
            self.events.push_back(LiveEvent::Expiring {
                time_left: go["timeLeft"].clone(),
            });
        }
        if let Some(ids) = value["toolCallCancellation"]["ids"].as_array() {
            let ids: Vec<String> = ids
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect();
            for id in &ids {
                self.calls.insert(id.clone(), ToolState::Cancelled);
            }
            self.events
                .push_back(LiveEvent::ToolsCancelled { call_ids: ids });
        }
        if let Some(calls) = value["toolCall"]["functionCalls"].as_array() {
            for c in calls {
                let id = c["id"].as_str().unwrap_or("");
                if !matches!(self.calls.get(id), Some(ToolState::Cancelled)) {
                    self.call(
                        id,
                        c["name"].as_str().unwrap_or(""),
                        c.get("args").cloned().unwrap_or_else(|| json!({})),
                    )?;
                }
            }
        }
        let content = &value["serverContent"];
        if content["interrupted"] == true {
            self.phase = ResponsePhase::Idle;
            self.events.push_back(LiveEvent::Interrupted);
        }
        for (key, input) in [("inputTranscription", true), ("outputTranscription", false)] {
            if let Some(text) = content[key]["text"].as_str() {
                self.events.push_back(LiveEvent::Transcript {
                    input,
                    text: text.into(),
                    final_result: content[key]["finished"] == true,
                    id: None,
                    text_output: false,
                });
            }
        }
        if let Some(parts) = content["modelTurn"]["parts"].as_array() {
            if self.phase != ResponsePhase::Active {
                self.events.push_back(LiveEvent::ResponseStarted);
                self.phase = ResponsePhase::Active;
            }
            for part in parts {
                if let Some(data) = part["inlineData"]["data"].as_str() {
                    if part["inlineData"]["mimeType"].as_str() != Some("audio/pcm;rate=24000") {
                        return Err(Error::Unsupported("live output must be 24 kHz PCM".into()));
                    }
                    self.audio(data, &Value::Null)?;
                }
                if let Some(text) = part["text"].as_str() {
                    self.events.push_back(LiveEvent::Transcript {
                        input: false,
                        text: text.into(),
                        final_result: false,
                        id: None,
                        text_output: true,
                    });
                }
            }
        }
        if let Some(activity) = value["voiceActivity"]["voiceActivityType"].as_str() {
            self.events.push_back(LiveEvent::ProviderState { state: json!({"inputActivity":match activity { "ACTIVITY_START" => "start", "ACTIVITY_END" => "end", _ => activity }}) });
        }
        if content.get("waitingForInput").is_some() {
            self.events.push_back(LiveEvent::ProviderState {
                state: json!({"waitingForInput":content["waitingForInput"]}),
            });
        }
        if content["turnComplete"] == true {
            self.phase = ResponsePhase::Idle;
            self.events.push_back(LiveEvent::ResponseEnded);
        }
        if let Some(usage) = value.get("usageMetadata").filter(|u| u.is_object()) {
            self.usage(None, usage);
        }
        Ok(())
    }
    fn usage(&mut self, model: Option<String>, usage: &Value) {
        self.events.push_back(LiveEvent::Usage {
            model: model.unwrap_or_else(|| self.model.clone()),
            usage: usage.clone(),
        });
    }
    fn openai_call(&mut self, item: &Value) -> Result<()> {
        let id = item["call_id"].as_str().unwrap_or("");
        if self.interrupted {
            self.calls.insert(id.into(), ToolState::Cancelled);
            return Ok(());
        }
        self.call(
            id,
            item["name"].as_str().unwrap_or(""),
            serde_json::from_str(item["arguments"].as_str().unwrap_or("{}"))?,
        )
    }
    async fn openai(&mut self, value: Value, cancellation: &CancellationToken) -> Result<()> {
        let kind = value["type"].as_str().unwrap_or("");
        match kind {
            "response.created" => {
                if self.phase == ResponsePhase::Active {
                    return Err(Error::Protocol("overlapping live responses".into()));
                }
                if self.phase != ResponsePhase::Requested {
                    self.cancel_tools();
                    self.interrupted = false;
                }
                self.phase = ResponsePhase::Active;
                self.has_tools = false;
                if !self.interrupted {
                    self.events.push_back(LiveEvent::ResponseStarted);
                }
            }
            "response.output_audio.delta" | "response.audio.delta" if !self.interrupted => {
                self.audio(value["delta"].as_str().unwrap_or(""), &value)?
            }
            "input_audio_buffer.speech_started" => {
                self.events.push_back(LiveEvent::SpeechStarted {
                    id: value["item_id"].as_str().map(str::to_owned),
                });
                // Server VAD owns the next response; do not race it with a queued text request.
                self.pending_response = false;
                self.interrupt(false, cancellation).await?;
            }
            "response.function_call_arguments.done" => self.openai_call(&value)?,
            "response.output_item.done" if value["item"]["type"] == "function_call" => {
                self.openai_call(&value["item"])?;
            }
            "response.done" => {
                // Cancelled and failed responses are billed too.
                if let Some(usage) = value["response"].get("usage").filter(|u| u.is_object()) {
                    self.usage(None, usage);
                }
                let status = value["response"]["status"].as_str().unwrap_or("");
                if status == "cancelled" || status == "failed" {
                    self.interrupt(false, cancellation).await?;
                } else if let Some(items) = value["response"]["output"].as_array() {
                    for item in items.iter().filter(|item| item["type"] == "function_call") {
                        self.openai_call(item)?;
                    }
                }
                self.phase = ResponsePhase::Idle;
                if status == "failed" {
                    return Err(Error::Protocol(
                        value["response"]["status_details"].to_string(),
                    ));
                }
                self.events.push_back(LiveEvent::ResponseEnded);
                self.continue_response(cancellation).await?;
            }
            "conversation.item.input_audio_transcription.failed" => {
                self.events.push_back(LiveEvent::TranscriptionFailed {
                    id: value["item_id"].as_str().map(str::to_owned),
                    error: value["error"].clone(),
                });
            }
            _ if kind.contains("transcription")
                || kind.contains("transcript")
                || kind.starts_with("response.output_text.") =>
            {
                let input = kind.starts_with("conversation.item.input");
                if kind == "conversation.item.input_audio_transcription.completed"
                    && let Some(usage) = value.get("usage").filter(|u| u.is_object())
                {
                    self.usage(self.transcription_model.clone(), usage);
                }
                if self.interrupted && !input {
                    return Ok(());
                }
                if let Some(text) = value["delta"]
                    .as_str()
                    .or(value["transcript"].as_str())
                    .or(value["text"].as_str())
                {
                    self.events.push_back(LiveEvent::Transcript {
                        input,
                        text: text.into(),
                        final_result: kind.ends_with(".done") || kind.ends_with(".completed"),
                        id: value["item_id"].as_str().map(str::to_owned),
                        text_output: kind.starts_with("response.output_text."),
                    });
                }
            }
            _ => {}
        }
        Ok(())
    }
}
