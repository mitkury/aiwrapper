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
use tokio::sync::Mutex;
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
            let cancelled_calls = Arc::new(Mutex::new(HashSet::new()));
            let sender = LiveSender {
                provider: self.provider,
                sender: Arc::new(Mutex::new(socket.sender)),
                cancellation: self.cancellation.clone(),
                cancelled_calls: cancelled_calls.clone(),
            };
            let receiver = LiveReceiver {
                provider: self.provider,
                receiver: socket.receiver,
                cancellation: self.cancellation.clone(),
                queued,
                events: VecDeque::new(),
                seen_calls: HashSet::new(),
                cancelled_calls,
                closed: false,
                active: false,
                suppress_audio: false,
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
    sender: Arc<Mutex<JsonSink>>,
    cancellation: CancellationToken,
    cancelled_calls: Arc<Mutex<HashSet<String>>>,
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
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(Error::Cancelled),
            result = async { self.sender.lock().await.send(value).await } => result,
        }
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
            self.send(json!({"type":"conversation.item.create","item":{"type":"message","role":if role==Role::Assistant {"assistant"} else {"user"},"content":[{"type":if role==Role::Assistant {"output_text"} else {"input_text"},"text":text}]}})).await?;
            if turn_complete {
                self.send(json!({"type":"response.create"})).await?;
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
        let cancelled = self.cancelled_calls.lock().await.clone();
        let active: Vec<_> = results
            .iter()
            .filter(|r| !cancelled.contains(&r.call_id))
            .collect();
        if active.is_empty() {
            return Ok(());
        }
        if self.provider == LiveProvider::Google {
            self.send(json!({"toolResponse":{"functionResponses":active.iter().map(|r|json!({"id":r.call_id,"name":r.name,"response":if r.result.is_object() {r.result.clone()} else {json!({"result":r.result})}})).collect::<Vec<_>>()}})).await
        } else {
            for r in active {
                self.send(json!({"type":"conversation.item.create","item":{"type":"function_call_output","call_id":r.call_id,"output":r.result.to_string()}})).await?;
            }
            self.send(json!({"type":"response.create"})).await
        }
    }
    pub async fn interrupt(&self) -> Result<()> {
        if self.provider == LiveProvider::Google {
            return Err(Error::Unsupported(
                "Gemini interruptions follow input activity detection".into(),
            ));
        }
        self.send(json!({"type":"response.cancel"})).await
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
        let result = tokio::time::timeout(Duration::from_secs(2), async {
            self.sender.lock().await.close().await
        })
        .await;
        self.cancellation.cancel();
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
pub struct LiveReceiver {
    provider: LiveProvider,
    receiver: BoxStream<'static, Result<Value>>,
    cancellation: CancellationToken,
    queued: VecDeque<Value>,
    events: VecDeque<LiveEvent>,
    seen_calls: HashSet<String>,
    cancelled_calls: Arc<Mutex<HashSet<String>>>,
    closed: bool,
    active: bool,
    suppress_audio: bool,
}
impl LiveReceiver {
    pub async fn next_event(&mut self) -> Result<Option<LiveEvent>> {
        loop {
            crate::error::check_cancel(&self.cancellation)?;
            if let Some(event) = self.events.pop_front() {
                return Ok(Some(event));
            }
            if self.closed {
                return Ok(None);
            }
            let value = if let Some(value) = self.queued.pop_front() {
                value
            } else {
                tokio::select! {
                    biased;
                    _ = self.cancellation.cancelled() => return Err(Error::Cancelled),
                    value = self.receiver.next() => match value {Some(v)=>v?,None=>json!({"__closed":true})},
                }
            };
            if let Some(error) = value.get("error") {
                return Err(Error::Protocol(error.to_string()));
            }
            if value["__closed"] == true {
                self.closed = true;
                self.events.push_back(LiveEvent::Closed {
                    code: value["code"].as_u64().map(|v| v as u16),
                    reason: value["reason"].as_str().map(str::to_owned),
                });
            } else if self.provider == LiveProvider::Google {
                self.google(value).await?;
            } else {
                self.openai(value)?;
            }
        }
    }
    fn audio(&mut self, data: &str, value: &Value) -> Result<()> {
        if self.suppress_audio {
            return Ok(());
        }
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
        if self.seen_calls.insert(id.into()) {
            self.events.push_back(LiveEvent::ToolCall {
                call_id: id.into(),
                name: name.into(),
                arguments,
            });
        }
        Ok(())
    }
    async fn google(&mut self, value: Value) -> Result<()> {
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
            self.cancelled_calls.lock().await.extend(ids.clone());
            self.events
                .push_back(LiveEvent::ToolsCancelled { call_ids: ids });
        }
        if let Some(calls) = value["toolCall"]["functionCalls"].as_array() {
            for c in calls {
                let id = c["id"].as_str().unwrap_or("");
                if !self.cancelled_calls.lock().await.contains(id) {
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
            self.active = false;
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
            if !self.active {
                self.events.push_back(LiveEvent::ResponseStarted);
                self.active = true;
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
            self.active = false;
            self.events.push_back(LiveEvent::ResponseEnded);
        }
        Ok(())
    }
    fn openai(&mut self, value: Value) -> Result<()> {
        let kind = value["type"].as_str().unwrap_or("");
        match kind {
            "response.created" => {
                self.active = true;
                self.suppress_audio = false;
                self.events.push_back(LiveEvent::ResponseStarted);
            }
            "response.output_audio.delta" | "response.audio.delta" => {
                self.audio(value["delta"].as_str().unwrap_or(""), &value)?
            }
            "input_audio_buffer.speech_started" => {
                self.events.push_back(LiveEvent::SpeechStarted);
                if self.active {
                    self.suppress_audio = true;
                    self.events.push_back(LiveEvent::Interrupted);
                }
            }
            "response.function_call_arguments.done" => self.call(
                value["call_id"].as_str().unwrap_or(""),
                value["name"].as_str().unwrap_or(""),
                serde_json::from_str(value["arguments"].as_str().unwrap_or("{}"))?,
            )?,
            "response.output_item.done" if value["item"]["type"] == "function_call" => {
                let item = &value["item"];
                self.call(
                    item["call_id"].as_str().unwrap_or(""),
                    item["name"].as_str().unwrap_or(""),
                    serde_json::from_str(item["arguments"].as_str().unwrap_or("{}"))?,
                )?;
            }
            "response.done" => {
                self.active = false;
                if value["response"]["status"] == "failed" {
                    return Err(Error::Protocol(
                        value["response"]["status_details"].to_string(),
                    ));
                }
                self.events.push_back(LiveEvent::ResponseEnded);
            }
            "conversation.item.input_audio_transcription.failed" => {
                return Err(Error::Protocol(value.to_string()));
            }
            _ if kind.contains("transcription")
                || kind.contains("transcript")
                || kind.starts_with("response.output_text.") =>
            {
                if let Some(text) = value["delta"]
                    .as_str()
                    .or(value["transcript"].as_str())
                    .or(value["text"].as_str())
                {
                    self.events.push_back(LiveEvent::Transcript {
                        input: kind.starts_with("conversation.item.input"),
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
