use aiwrapper::{live::*, speech::PcmFrame, *};
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};

struct SocketFixture {
    sent: Arc<Mutex<Vec<Value>>>,
    events: Vec<Value>,
}
impl SocketFixture {
    fn new(events: Vec<Value>) -> Self {
        Self {
            sent: Arc::new(Mutex::new(vec![])),
            events,
        }
    }
}
#[async_trait]
impl LiveTransport for SocketFixture {
    async fn connect(
        &self,
        _url: String,
        _headers: BTreeMap<String, String>,
    ) -> Result<LiveSocket> {
        let sent = self.sent.clone();
        let sender = futures_util::sink::unfold(
            sent,
            |sent: Arc<Mutex<Vec<Value>>>, value: Value| async move {
                sent.lock().unwrap().push(value);
                Ok::<_, Error>(sent)
            },
        );
        Ok(LiveSocket {
            sender: Box::pin(sender),
            receiver: futures_util::stream::iter(self.events.clone().into_iter().map(Ok)).boxed(),
        })
    }
}
#[tokio::test]
async fn google_waits_for_setup_then_sends_pcm_context_and_manual_results() {
    let fixture = SocketFixture::new(vec![
        json!({"setupComplete":{}}),
        json!({"toolCall":{"functionCalls":[{"id":"c","name":"add","args":{"a":2}}]}}),
        json!({"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQD//w=="}}]},"turnComplete":true}}),
    ]);
    let mut config = LiveConfig::new(LiveProvider::Google, "test", "key");
    config.settings.insert(
        "contextWindowCompression".into(),
        json!({"slidingWindow":{}}),
    );
    config
        .settings
        .insert("sessionResumption".into(), json!({"handle":"previous"}));
    let mut session = config.connect_with(&fixture).await.unwrap();
    session
        .sender
        .append_audio(&PcmFrame {
            samples: vec![1, -1],
            sample_rate: 16000,
        })
        .await
        .unwrap();
    session
        .sender
        .send_text("Context", Role::Assistant, false)
        .await
        .unwrap();
    assert!(
        matches!(session.receiver.next_event().await.unwrap(),Some(LiveEvent::ToolCall {call_id,..}) if call_id=="c")
    );
    session
        .sender
        .send_tool_results(&[LiveToolResult {
            call_id: "c".into(),
            name: "add".into(),
            result: json!(3),
        }])
        .await
        .unwrap();
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseStarted)
    ));
    assert!(
        matches!(session.receiver.next_event().await.unwrap(),Some(LiveEvent::Audio {frame,..}) if frame.samples==vec![1,-1])
    );
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    let sent = fixture.sent.lock().unwrap();
    assert_eq!(sent[0]["setup"]["sessionResumption"]["handle"], "previous");
    assert_eq!(sent[1]["realtimeInput"]["audio"]["data"], "AQD//w==");
    assert_eq!(sent[2]["clientContent"]["turnComplete"], false);
    assert_eq!(
        sent[3]["toolResponse"]["functionResponses"][0]["response"]["result"],
        3
    );
}
#[tokio::test]
async fn cancelled_google_tools_are_not_delivered_and_resumption_events_survive() {
    let fixture = SocketFixture::new(vec![
        json!({"setupComplete":{}}),
        json!({"toolCallCancellation":{"ids":["c"]}}),
        json!({"sessionResumptionUpdate":{"resumable":true,"newHandle":"new"}}),
    ]);
    let mut session = LiveConfig::new(LiveProvider::Google, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ToolsCancelled { .. })
    ));
    session
        .sender
        .send_tool_results(&[LiveToolResult {
            call_id: "c".into(),
            name: "tool".into(),
            result: json!(true),
        }])
        .await
        .unwrap();
    assert_eq!(fixture.sent.lock().unwrap().len(), 1);
    assert!(
        matches!(session.receiver.next_event().await.unwrap(),Some(LiveEvent::Resumption {handle:Some(h),..}) if h=="new")
    );
}
#[tokio::test]
async fn openai_deduplicates_calls_suppresses_interrupted_audio_and_truncates() {
    let call = json!({"type":"response.function_call_arguments.done","call_id":"c","name":"add","arguments":"{}"});
    let fixture = SocketFixture::new(vec![
        json!({"type":"session.created"}),
        json!({"type":"session.updated"}),
        call.clone(),
        call,
        json!({"type":"response.created"}),
        json!({"type":"input_audio_buffer.speech_started"}),
        json!({"type":"response.output_audio.delta","delta":"AQD//w=="}),
        json!({"type":"response.done","response":{"status":"cancelled"}}),
    ]);
    let mut session = LiveConfig::new(LiveProvider::Openai, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ToolCall { .. })
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseStarted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::SpeechStarted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::Interrupted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    session.sender.truncate_audio("item", 0, 123).await.unwrap();
    assert_eq!(
        fixture.sent.lock().unwrap().last().unwrap()["audio_end_ms"],
        123
    );
    assert!(
        session
            .sender
            .append_audio(&PcmFrame {
                samples: vec![1],
                sample_rate: 16000
            })
            .await
            .is_err()
    );
}
#[tokio::test]
async fn failed_setup_and_cancellation_are_errors() {
    let fixture = SocketFixture::new(vec![json!({"error":{"message":"bad config"}})]);
    assert!(
        LiveConfig::new(LiveProvider::Google, "test", "key")
            .connect_with(&fixture)
            .await
            .is_err()
    );
    let fixture = SocketFixture::new(vec![json!({"type":"session.created"})]);
    assert!(
        LiveConfig::new(LiveProvider::Openai, "test", "key")
            .connect_with(&fixture)
            .await
            .is_err()
    );
    let config = LiveConfig::new(LiveProvider::Openai, "test", "key");
    config.cancellation.cancel();
    assert!(matches!(
        config.connect_with(&fixture).await,
        Err(Error::Cancelled)
    ));
}
#[tokio::test]
async fn default_websocket_transport_completes_a_real_handshake() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let request = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert!(request.contains("session.update"));
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({"type":"session.updated"}).to_string().into(),
            ))
            .await
            .unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({"type":"response.created"}).to_string().into(),
            ))
            .await
            .unwrap();
        socket.close(None).await.unwrap();
    });
    let mut config = LiveConfig::new(LiveProvider::Openai, "test", "key");
    config.endpoint = format!("ws://{addr}");
    config.connect_timeout = Duration::from_secs(2);
    let mut session = config.connect().await.unwrap();
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseStarted)
    ));
    server.await.unwrap();
}

#[tokio::test]
async fn closing_a_session_does_not_cancel_the_hosts_parent_token() {
    let parent = CancellationToken::new();
    let mut config = LiveConfig::new(LiveProvider::Google, "test", "key");
    config.cancellation = parent.clone();
    let fixture = SocketFixture::new(vec![json!({"setupComplete":{}})]);
    let session = config.connect_with(&fixture).await.unwrap();
    session.sender.close().await.unwrap();
    assert!(!parent.is_cancelled());
    assert!(matches!(
        session.sender.send_text("Hi", Role::User, true).await,
        Err(Error::Cancelled)
    ));
}
