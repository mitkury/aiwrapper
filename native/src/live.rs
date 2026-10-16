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
}
impl LiveConfig {
    pub fn new(
        provider: LiveProvider,
        model: impl Into<String>,
        api_key: impl Into<String>,
    ) -> Self {
        Self { provider,model:model.into(),api_key:api_key.into(),voice:if provider == LiveProvider::Google {"Kore"} else {"marin"}.into(),
            endpoint:if provider == LiveProvider::Google {"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"} else {"wss://api.openai.com/v1/realtime"}.into(),
            instructions:String::new(),tools:vec![],settings:BTreeMap::new(),headers:BTreeMap::new(),cancellation:CancellationToken::new(),connect_timeout:Duration::from_secs(15) }
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
        let mut headers = self.headers;
        if self.provider == LiveProvider::Google {
            url.query_pairs_mut().append_pair("key", &self.api_key);
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
                state: Mutex::new(LiveState {
                    sender: socket.sender,
                    phase: ResponsePhase::Idle,
                    interrupted: false,
                    pending_response: false,
                    has_tools: false,
                    calls: BTreeMap::new(),
                    events: VecDeque::new(),
                    closed: false,
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
            };
            Ok(LiveSession { sender, receiver })
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
            if result.result["type"] == "tool-content" {
                return Err(Error::Unsupported(
                    "multimodal live tool results are not implemented; supply JSON tool results"
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
            state.send(json!({"toolResponse":{"functionResponses":active.iter().map(|r|json!({"id":r.call_id,"name":r.name,"response":if r.result.is_object() {r.result.clone()} else {json!({"result":r.result})}})).collect::<Vec<_>>()}}), &self.connection.cancellation).await?;
        } else {
            for r in &active {
                state.send(json!({"type":"conversation.item.create","item":{"type":"function_call_output","call_id":r.call_id,"output":r.result.to_string()}}), &self.connection.cancellation).await?;
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
            state.sender.close().await
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
    },
    SpeechStarted,
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
    Closed {
        code: Option<u16>,
        reason: Option<String>,
    },
}
// One lock orders state changes with socket writes. There is no background task:
// the host must keep polling the receiver while sending input and running tools.
struct LiveConnection {
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
enum ToolState {
    Pending(String),
    Sent,
    Cancelled,
}
struct LiveState {
    sender: JsonSink,
    phase: ResponsePhase,
    interrupted: bool,
    pending_response: bool,
    has_tools: bool,
    calls: BTreeMap<String, ToolState>,
    events: VecDeque<LiveEvent>,
    closed: bool,
}
pub struct LiveReceiver {
    provider: LiveProvider,
    receiver: BoxStream<'static, Result<Value>>,
    connection: Arc<LiveConnection>,
    queued: VecDeque<Value>,
}
impl LiveReceiver {
    pub async fn next_event(&mut self) -> Result<Option<LiveEvent>> {
        let result = self.receive().await;
        if result.is_err() {
            self.connection.cancellation.cancel();
            let mut state = self.connection.state.lock().await;
            state.closed = true;
            state.events.clear();
        }
        result
    }
    async fn receive(&mut self) -> Result<Option<LiveEvent>> {
        loop {
            {
                let mut state = self.connection.state.lock().await;
                if !state.closed {
                    crate::error::check_cancel(&self.connection.cancellation)?;
                }
                if let Some(event) = state.events.pop_front() {
                    return Ok(Some(event));
                }
                if state.closed {
                    return Ok(None);
                }
            }
            let value = if let Some(value) = self.queued.pop_front() {
                value
            } else {
                tokio::select! {
                    biased;
                    _ = self.connection.cancellation.cancelled() => continue,
                    _ = self.connection.changed.notified() => continue,
                    value = self.receiver.next() => match value {Some(v)=>v?,None=>json!({"__closed":true})},
                }
            };
            let mut state = self.connection.state.lock().await;
            crate::error::check_cancel(&self.connection.cancellation)?;
            if let Some(error) = value.get("error") {
                // Generation can finish on the server while cancellation is in flight.
                // Its response.done still governs continuation; this error is harmless.
                if self.provider == LiveProvider::Openai
                    && error["code"] == "response_cancel_not_active"
                {
                    continue;
                }
                return Err(Error::Protocol(error.to_string()));
            }
            if value["__closed"] == true {
                state.closed = true;
                self.connection.cancellation.cancel();
                state.events.push_back(LiveEvent::Closed {
                    code: value["code"].as_u64().and_then(|v| v.try_into().ok()),
                    reason: value["reason"].as_str().map(str::to_owned),
                });
            } else if self.provider == LiveProvider::Google {
                state.google(value)?;
            } else {
                state.openai(value, &self.connection.cancellation).await?;
            }
        }
    }
}
impl LiveState {
    async fn send(&mut self, value: Value, cancellation: &CancellationToken) -> Result<()> {
        let result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(Error::Cancelled),
            result = self.sender.send(value) => result,
        };
        if result.is_err() {
            self.closed = true;
            self.events.clear();
            cancellation.cancel();
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
                    });
                }
            }
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
        Ok(())
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
                self.events.push_back(LiveEvent::SpeechStarted);
                // Server VAD owns the next response; do not race it with a queued text request.
                self.pending_response = false;
                self.interrupt(false, cancellation).await?;
            }
            "response.function_call_arguments.done" => self.openai_call(&value)?,
            "response.output_item.done" if value["item"]["type"] == "function_call" => {
                self.openai_call(&value["item"])?;
            }
            "response.done" => {
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
                return Err(Error::Protocol(value.to_string()));
            }
            _ if kind.contains("transcription")
                || kind.contains("transcript")
                || kind.starts_with("response.output_text.") =>
            {
                let input = kind.starts_with("conversation.item.input");
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
                    });
                }
            }
            _ => {}
        }
        Ok(())
    }
}
