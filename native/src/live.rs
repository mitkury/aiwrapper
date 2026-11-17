//! Duplex live sessions. Hosts own media transport, playback and persistence.
//! Public handles route operations to a backend; tool orchestration does not
//! depend on provider sockets or their connection state.
use crate::{speech::PcmFrame, *};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[path = "live-agent.rs"]
mod agent;
pub use agent::*;
mod cascade;
mod socket;
pub use cascade::CascadeConfig;
use cascade::{CascadeReceiver, CascadeSender};
pub use socket::{
    LiveConfig, LiveProvider, LiveResumption, LiveSocket, LiveTransport, WebSocketTransport,
};
use socket::{SocketReceiver, SocketSender};

pub struct LiveSession {
    pub sender: LiveSender,
    pub receiver: LiveReceiver,
    tools: Vec<ToolDefinition>,
}
impl LiveSession {
    fn from_socket(
        sender: SocketSender,
        receiver: SocketReceiver,
        tools: Vec<ToolDefinition>,
    ) -> Self {
        Self {
            sender: LiveSender {
                backend: SenderBackend::Socket(sender),
            },
            receiver: LiveReceiver {
                backend: ReceiverBackend::Socket(receiver),
            },
            tools,
        }
    }
}

#[derive(Clone)]
enum SenderBackend {
    Socket(SocketSender),
    Cascade(CascadeSender),
}

/// Cloneable input handle. Clones remain attached to their original session.
#[derive(Clone)]
pub struct LiveSender {
    backend: SenderBackend,
}
impl LiveSender {
    pub fn input_sample_rate(&self) -> u32 {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.input_sample_rate(),
            SenderBackend::Cascade(sender) => sender.input_sample_rate(),
        }
    }
    pub async fn append_audio(&self, frame: &PcmFrame) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.append_audio(frame).await,
            SenderBackend::Cascade(sender) => sender.append_audio(frame).await,
        }
    }
    pub async fn end_audio(&self) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.end_audio().await,
            SenderBackend::Cascade(sender) => sender.end_audio().await,
        }
    }
    pub async fn send_text(&self, text: &str, role: Role, turn_complete: bool) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.send_text(text, role, turn_complete).await,
            SenderBackend::Cascade(sender) => sender.send_text(text, role, turn_complete).await,
        }
    }
    /// User activity input; silent context uses send_text(..., false) instead.
    pub async fn send_realtime_text(&self, text: &str) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.send_realtime_text(text).await,
            SenderBackend::Cascade(sender) => sender.send_text(text, Role::User, true).await,
        }
    }
    pub async fn resumption(&self) -> Option<LiveResumption> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.resumption().await,
            SenderBackend::Cascade(_) => None,
        }
    }
    pub async fn append_image(&self, data: &str, mime: &str) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.append_image(data, mime).await,
            SenderBackend::Cascade(sender) => sender.append_image(data, mime).await,
        }
    }
    pub async fn send_tool_results(&self, results: &[LiveToolResult]) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.send_tool_results(results).await,
            SenderBackend::Cascade(sender) => sender.send_tool_results(results).await,
        }
    }
    pub async fn interrupt(&self) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.interrupt().await,
            SenderBackend::Cascade(sender) => sender.interrupt().await,
        }
    }
    pub async fn truncate_audio(
        &self,
        item_id: &str,
        content_index: usize,
        played_ms: u64,
    ) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => {
                sender
                    .truncate_audio(item_id, content_index, played_ms)
                    .await
            }
            SenderBackend::Cascade(sender) => {
                sender
                    .truncate_audio(item_id, content_index, played_ms)
                    .await
            }
        }
    }
    pub async fn close(&self) -> Result<()> {
        match &self.backend {
            SenderBackend::Socket(sender) => sender.close().await,
            SenderBackend::Cascade(sender) => sender.close().await,
        }
    }
    // Called with the tool delivery route locked, before installing the new session.
    async fn inherit_pending_calls(&self, previous: &Self) -> Result<bool> {
        match (&self.backend, &previous.backend) {
            (SenderBackend::Socket(next), SenderBackend::Socket(previous)) => {
                next.inherit_pending_calls(previous).await
            }
            _ => Ok(false),
        }
    }
}

enum ReceiverBackend {
    Socket(SocketReceiver),
    Cascade(CascadeReceiver),
}

/// Ordered output handle. Dropping it cancels its session, including sender clones.
pub struct LiveReceiver {
    backend: ReceiverBackend,
}
impl LiveReceiver {
    /// Drain the normalized events from one backend update as an ordered batch.
    /// Cancelling a pending poll does not discard consumed protocol input.
    pub async fn next_events(&mut self) -> Result<Option<Vec<LiveEvent>>> {
        match &mut self.backend {
            ReceiverBackend::Socket(receiver) => receiver.next_events().await,
            ReceiverBackend::Cascade(receiver) => receiver.next_events().await,
        }
    }
    pub async fn next_event(&mut self) -> Result<Option<LiveEvent>> {
        match &mut self.backend {
            ReceiverBackend::Socket(receiver) => receiver.next_event().await,
            ReceiverBackend::Cascade(receiver) => receiver.next_event().await,
        }
    }
    async fn drain_received(&mut self) -> Result<Vec<LiveEvent>> {
        match &mut self.backend {
            ReceiverBackend::Socket(receiver) => receiver.drain_received().await,
            ReceiverBackend::Cascade(receiver) => receiver.drain_received().await,
        }
    }
    fn cancel_pending_receive(&mut self) {
        match &mut self.backend {
            ReceiverBackend::Socket(receiver) => receiver.cancel_pending_receive(),
            ReceiverBackend::Cascade(_) => {}
        }
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
    Closed {
        code: Option<u16>,
        reason: Option<String>,
    },
}
