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
    stay_open: bool,
    fail_writes_after_setup: bool,
    block_writes_after_setup: bool,
    connection: Mutex<Option<(String, BTreeMap<String, String>)>>,
}
impl SocketFixture {
    fn new(events: Vec<Value>) -> Self {
        Self {
            sent: Arc::new(Mutex::new(vec![])),
            events,
            stay_open: false,
            fail_writes_after_setup: false,
            block_writes_after_setup: false,
            connection: Mutex::new(None),
        }
    }
    fn count(&self, kind: &str) -> usize {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter(|v| v["type"] == kind)
            .count()
    }
}

fn tool_call(id: &str) -> Value {
    json!({"type":"response.function_call_arguments.done","call_id":id,"name":"add","arguments":"{}"})
}
fn tool_result(id: &str) -> LiveToolResult {
    LiveToolResult {
        call_id: id.into(),
        name: "add".into(),
        result: json!(3),
        images: vec![],
    }
}
async fn openai_session(events: Vec<Value>) -> (LiveSession, SocketFixture) {
    let fixture = SocketFixture::new(
        std::iter::once(json!({"type":"session.updated"}))
            .chain(events)
            .collect(),
    );
    let session = LiveConfig::new(LiveProvider::Openai, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    (session, fixture)
}

#[tokio::test]
async fn fast_tool_results_wait_for_done_and_all_calls_before_continuing() {
    let (mut session, fixture) = openai_session(vec![
        json!({"type":"response.created"}),
        tool_call("a"),
        tool_call("b"),
        json!({"type":"response.done","response":{"status":"completed","output":[
            {"type":"function_call","call_id":"a","name":"add","arguments":"{}"},
            {"type":"function_call","call_id":"b","name":"add","arguments":"{}"}
        ]}}),
    ])
    .await;
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseStarted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ToolCall { .. })
    ));
    session
        .sender
        .send_tool_results(&[tool_result("a")])
        .await
        .unwrap();
    assert_eq!(fixture.count("response.create"), 0);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ToolCall { .. })
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    assert_eq!(fixture.count("response.create"), 0);
    session
        .sender
        .send_tool_results(&[tool_result("b")])
        .await
        .unwrap();
    assert_eq!(fixture.count("response.create"), 1);
    assert!(
        session
            .sender
            .send_tool_results(&[tool_result("b")])
            .await
            .is_err()
    );
    assert_eq!(fixture.count("conversation.item.create"), 2);
}

#[tokio::test]
async fn done_discovers_calls_and_concurrent_results_resume_once() {
    let (mut session, fixture) = openai_session(vec![
        json!({"type":"response.created"}),
        json!({"type":"response.done","response":{"status":"completed","output":[
            {"type":"function_call","call_id":"a","name":"add","arguments":"{}"},
            {"type":"function_call","call_id":"b","name":"add","arguments":"{}"}
        ]}}),
    ])
    .await;
    for _ in 0..4 {
        session.receiver.next_event().await.unwrap().unwrap();
    }
    let other = session.sender.clone();
    let a = [tool_result("a")];
    let b = [tool_result("b")];
    let (a, b) = tokio::join!(
        session.sender.send_tool_results(&a),
        other.send_tool_results(&b)
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(fixture.count("response.create"), 1);
}

#[tokio::test]
async fn explicit_interrupt_before_created_suppresses_output_and_cancels_once() {
    let (mut session, fixture) = openai_session(vec![
        json!({"type":"response.created"}),
        json!({"type":"response.output_audio.delta","delta":"AQD//w=="}),
        tool_call("late"),
        json!({"type":"response.done","response":{"status":"cancelled"}}),
    ])
    .await;
    session.sender.interrupt().await.unwrap(); // Idle is harmless.
    assert_eq!(fixture.count("response.cancel"), 0);
    session
        .sender
        .send_text("Hello", Role::User, true)
        .await
        .unwrap();
    session.sender.interrupt().await.unwrap();
    session.sender.interrupt().await.unwrap();
    assert_eq!(fixture.count("response.cancel"), 1);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::Interrupted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    session
        .sender
        .send_tool_results(&[tool_result("late")])
        .await
        .unwrap();
    assert_eq!(fixture.count("response.create"), 1);
}

#[tokio::test]
async fn new_text_cancels_active_response_and_waits_before_starting_another() {
    let (mut session, fixture) = openai_session(vec![
        json!({"type":"response.created"}),
        tool_call("a"),
        json!({"type":"response.output_audio.delta","delta":"AQD//w=="}),
        json!({"type":"response.done","response":{"status":"cancelled"}}),
        json!({"type":"error","error":{"code":"response_cancel_not_active"}}),
        json!({"type":"response.created"}),
        json!({"type":"response.output_audio.delta","delta":"AQD//w=="}),
    ])
    .await;
    session.receiver.next_event().await.unwrap();
    session.receiver.next_event().await.unwrap();
    session
        .sender
        .send_text("New question", Role::User, true)
        .await
        .unwrap();
    assert_eq!(fixture.count("response.cancel"), 1);
    assert_eq!(fixture.count("response.create"), 0);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::Interrupted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ToolsCancelled { .. })
    ));
    session
        .sender
        .send_tool_results(&[tool_result("a")])
        .await
        .unwrap();
    assert_eq!(fixture.count("response.create"), 0);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    assert_eq!(fixture.count("response.create"), 1);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseStarted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::Audio { .. })
    ));
}

#[tokio::test]
async fn invalid_tool_result_batches_send_nothing() {
    let (mut session, fixture) =
        openai_session(vec![json!({"type":"response.created"}), tool_call("a")]).await;
    session.receiver.next_event().await.unwrap();
    session.receiver.next_event().await.unwrap();
    for batch in [
        vec![tool_result("a"), tool_result("unknown")],
        vec![tool_result("a"), tool_result("a")],
        vec![LiveToolResult {
            name: "wrong".into(),
            ..tool_result("a")
        }],
    ] {
        assert!(session.sender.send_tool_results(&batch).await.is_err());
    }
    assert_eq!(fixture.count("conversation.item.create"), 0);
}

#[tokio::test]
async fn fast_results_continue_on_done_and_later_turns_start_normally() {
    let (mut session, fixture) = openai_session(vec![
        json!({"type":"response.created"}),
        tool_call("a"),
        json!({"type":"response.done","response":{"status":"completed"}}),
        json!({"type":"response.created"}),
        json!({"type":"response.done","response":{"status":"completed"}}),
    ])
    .await;
    session.receiver.next_event().await.unwrap();
    session.receiver.next_event().await.unwrap();
    session
        .sender
        .send_tool_results(&[tool_result("a")])
        .await
        .unwrap();
    assert_eq!(fixture.count("response.create"), 0);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    assert_eq!(fixture.count("response.create"), 1);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseStarted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    assert_eq!(fixture.count("response.create"), 1);
    session
        .sender
        .send_text("Next question", Role::User, true)
        .await
        .unwrap();
    assert_eq!(fixture.count("response.create"), 2);
    assert_eq!(fixture.count("response.cancel"), 0);
}

#[tokio::test]
async fn interrupt_wakes_a_waiting_receiver_and_clears_undelivered_tool_calls() {
    let mut fixture = SocketFixture::new(vec![
        json!({"type":"session.updated"}),
        json!({"type":"response.created"}),
    ]);
    fixture.stay_open = true;
    let mut session = LiveConfig::new(LiveProvider::Openai, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    session.receiver.next_event().await.unwrap();
    let (event, result) = tokio::join!(
        tokio::time::timeout(Duration::from_secs(1), session.receiver.next_event()),
        async {
            tokio::task::yield_now().await;
            session.sender.interrupt().await
        }
    );
    result.unwrap();
    assert!(matches!(
        event.unwrap().unwrap(),
        Some(LiveEvent::Interrupted)
    ));

    let (mut session, fixture) = openai_session(vec![
        json!({"type":"response.created"}),
        json!({"type":"response.done","response":{"status":"completed","output":[
            {"type":"function_call","call_id":"a","name":"add","arguments":"{}"},
            {"type":"function_call","call_id":"b","name":"add","arguments":"{}"}
        ]}}),
    ])
    .await;
    session.receiver.next_event().await.unwrap();
    assert!(
        matches!(session.receiver.next_event().await.unwrap(), Some(LiveEvent::ToolCall { call_id, .. }) if call_id == "a")
    );
    session.sender.interrupt().await.unwrap();
    // Generation already ended, so cancellation is local and b is never delivered.
    assert_eq!(fixture.count("response.cancel"), 0);
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ResponseEnded)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::Interrupted)
    ));
    assert!(
        matches!(session.receiver.next_event().await.unwrap(), Some(LiveEvent::ToolsCancelled { call_ids }) if call_ids == vec!["a", "b"])
    );
    session
        .sender
        .send_tool_results(&[tool_result("a")])
        .await
        .unwrap();
    assert_eq!(fixture.count("response.create"), 0);
}

#[tokio::test]
async fn remote_close_and_protocol_errors_stop_both_halves() {
    for event in [
        json!({"__closed":true,"code":1000,"reason":"bye"}),
        json!({"error":{"message":"invalid session"}}),
        json!({"type":"response.output_audio.delta","delta":"invalid!"}),
        json!({"type":"response.done","response":{"status":"failed","status_details":{"error":"failed"}}}),
    ] {
        let closed = event["__closed"] == true;
        let (mut session, fixture) = openai_session(vec![event]).await;
        let result = session.receiver.next_event().await;
        if closed {
            assert!(matches!(
                result.unwrap(),
                Some(LiveEvent::Closed {
                    code: Some(1000),
                    ..
                })
            ));
        } else {
            assert!(result.is_err());
        }
        assert!(
            session
                .sender
                .send_text("Too late", Role::User, true)
                .await
                .is_err()
        );
        assert!(session.receiver.next_event().await.unwrap().is_none());
        assert_eq!(fixture.count("response.create"), 0);
    }
}
#[async_trait]
impl LiveTransport for SocketFixture {
    async fn connect(&self, url: String, headers: BTreeMap<String, String>) -> Result<LiveSocket> {
        *self.connection.lock().unwrap() = Some((url, headers));
        let sent = self.sent.clone();
        let fail_writes = self.fail_writes_after_setup;
        let block_writes = self.block_writes_after_setup;
        let sender = futures_util::sink::unfold(
            sent,
            move |sent: Arc<Mutex<Vec<Value>>>, value: Value| async move {
                if fail_writes && !sent.lock().unwrap().is_empty() {
                    return Err(Error::Protocol("fixture send failed".into()));
                }
                let block = block_writes && !sent.lock().unwrap().is_empty();
                if block {
                    futures_util::future::pending::<()>().await;
                }
                sent.lock().unwrap().push(value);
                Ok::<_, Error>(sent)
            },
        );
        Ok(LiveSocket {
            sender: Box::pin(sender),
            receiver: futures_util::stream::iter(self.events.clone().into_iter().map(Ok))
                .chain(if self.stay_open {
                    futures_util::stream::pending().boxed()
                } else {
                    futures_util::stream::empty().boxed()
                })
                .boxed(),
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
            images: vec![],
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
            images: vec![],
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
        json!({"type":"response.created"}),
        call.clone(),
        call,
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
        Some(LiveEvent::ResponseStarted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ToolCall { .. })
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::SpeechStarted { .. })
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::Interrupted)
    ));
    assert!(matches!(
        session.receiver.next_event().await.unwrap(),
        Some(LiveEvent::ToolsCancelled { .. })
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
    let mut session = config.connect_with(&fixture).await.unwrap();
    session.sender.close().await.unwrap();
    assert!(!parent.is_cancelled());
    assert!(matches!(
        session.sender.send_text("Hi", Role::User, true).await,
        Err(Error::Cancelled)
    ));
    assert!(session.receiver.next_event().await.unwrap().is_none());
}

#[tokio::test]
async fn send_failure_wakes_the_receiver_and_stops_sender_clones() {
    let mut fixture = SocketFixture::new(vec![json!({"type":"session.updated"})]);
    fixture.stay_open = true;
    fixture.fail_writes_after_setup = true;
    let mut session = LiveConfig::new(LiveProvider::Openai, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    let sender = session.sender.clone();
    let (event, result) = tokio::join!(
        tokio::time::timeout(Duration::from_secs(1), session.receiver.next_event()),
        async {
            tokio::task::yield_now().await;
            sender.send_text("Hello", Role::User, true).await
        }
    );
    assert!(result.is_err());
    assert!(event.unwrap().unwrap().is_none());
    assert!(
        session
            .sender
            .send_text("Too late", Role::User, true)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn pending_tools_resume_with_their_handle_but_completed_calls_can_be_replayed() {
    let fixture = SocketFixture::new(vec![
        json!({"setupComplete":{}}),
        json!({"toolCall":{"functionCalls":[{"id":"pending","name":"add","args":{}},{"id":"done","name":"add","args":{}}]}}),
        json!({"sessionResumptionUpdate":{"resumable":true,"newHandle":"resume-1"}}),
    ]);
    let mut session = LiveConfig::new(LiveProvider::Google, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    assert_eq!(
        session.receiver.next_events().await.unwrap().unwrap().len(),
        2
    );
    session
        .sender
        .send_tool_results(&[tool_result("done")])
        .await
        .unwrap();
    session.receiver.next_event().await.unwrap();
    let snapshot = session.sender.resumption().await.unwrap();
    let encoded = serde_json::to_value(&snapshot).unwrap();
    assert!(encoded["calls"].get("pending").is_some());
    assert!(encoded["calls"].get("done").is_none());
    session.sender.close().await.unwrap();

    let resumed = SocketFixture::new(vec![
        json!({"setupComplete":{}}),
        json!({"toolCall":{"functionCalls":[{"id":"pending","name":"add","args":{}},{"id":"done","name":"add","args":{}}]}}),
    ]);
    let mut config = LiveConfig::new(LiveProvider::Google, "test", "key");
    config.resumption = Some(snapshot.clone());
    assert!(config.connect_with(&resumed).await.is_err());
    let mut config = LiveConfig::new(LiveProvider::Google, "test", "key");
    config.resumption = Some(snapshot.clone());
    config
        .settings
        .insert("sessionResumption".into(), json!({"handle":"different"}));
    assert!(config.connect_with(&resumed).await.is_err());
    let mut config = LiveConfig::new(LiveProvider::Google, "test", "key");
    config.resumption = Some(snapshot.clone());
    config
        .settings
        .insert("sessionResumption".into(), json!({"handle":"resume-1"}));
    let mut session = config.connect_with(&resumed).await.unwrap();
    let events = session.receiver.next_events().await.unwrap().unwrap();
    assert_eq!(
        events.len(),
        1,
        "pending calls stay with their original executor"
    );
    assert!(matches!(&events[0], LiveEvent::ToolCall {call_id,..} if call_id == "done"));
    session
        .sender
        .send_tool_results(&[tool_result("pending"), tool_result("done")])
        .await
        .unwrap();
    assert_eq!(
        resumed.sent.lock().unwrap()[1]["toolResponse"]["functionResponses"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let fresh = SocketFixture::new(vec![json!({"setupComplete":{}})]);
    let session = LiveConfig::new(LiveProvider::Google, "test", "key")
        .connect_with(&fresh)
        .await
        .unwrap();
    assert!(
        session
            .sender
            .send_tool_results(&[tool_result("pending")])
            .await
            .is_err()
    );
}

#[tokio::test]
async fn result_images_follow_their_call_and_cancelled_images_are_never_sent() {
    for provider in [LiveProvider::Google, LiveProvider::Openai] {
        let events = if provider == LiveProvider::Google {
            vec![
                json!({"setupComplete":{}}),
                json!({"toolCall":{"functionCalls":[{"id":"picture","name":"add","args":{}}]}}),
                json!({"toolCallCancellation":{"ids":["picture"]}}),
            ]
        } else {
            vec![
                json!({"type":"session.updated"}),
                json!({"type":"response.created"}),
                tool_call("picture"),
                json!({"type":"input_audio_buffer.speech_started"}),
            ]
        };
        let fixture = SocketFixture::new(events);
        let mut session = LiveConfig::new(provider, "test", "key")
            .connect_with(&fixture)
            .await
            .unwrap();
        if provider == LiveProvider::Openai {
            session.receiver.next_event().await.unwrap();
        }
        session.receiver.next_event().await.unwrap();
        let mut result = tool_result("picture");
        result.images.push(LiveImage {
            data: "cGljdHVyZQ==".into(),
            mime_type: "image/png".into(),
        });
        session
            .sender
            .send_tool_results(&[result.clone()])
            .await
            .unwrap();
        let before = fixture.sent.lock().unwrap().clone();
        if provider == LiveProvider::Google {
            assert_eq!(
                before[1]["toolResponse"]["functionResponses"][0]["id"],
                "picture"
            );
            assert_eq!(
                before[1]["toolResponse"]["functionResponses"][0]["parts"][0]["inlineData"]["data"],
                result.images[0].data
            );
        } else {
            assert_eq!(before[1]["item"]["call_id"], "picture");
            assert_eq!(
                before[2]["item"]["content"][0]["image_url"],
                "data:image/png;base64,cGljdHVyZQ=="
            );
        }
        // Already sent calls remain sent on OpenAI; exercise cancellation before delivery separately below.
    }
    let fixture = SocketFixture::new(vec![
        json!({"setupComplete":{}}),
        json!({"toolCallCancellation":{"ids":["picture"]}}),
    ]);
    let mut session = LiveConfig::new(LiveProvider::Google, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    session.receiver.next_event().await.unwrap();
    let mut result = tool_result("picture");
    result.images.push(LiveImage {
        data: "cGljdHVyZQ==".into(),
        mime_type: "image/png".into(),
    });
    session.sender.send_tool_results(&[result]).await.unwrap();
    assert_eq!(fixture.sent.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn transcript_failures_keep_utterance_identity_and_do_not_end_the_connection() {
    let (mut session, _) = openai_session(vec![
        json!({"type":"input_audio_buffer.speech_started","item_id":"utterance-1"}),
        json!({"type":"conversation.item.input_audio_transcription.failed","item_id":"utterance-1","error":{"message":"audio unavailable"}}),
        json!({"type":"conversation.item.input_audio_transcription.completed","item_id":"utterance-2","transcript":"still here"}),
    ]).await;
    assert!(
        matches!(session.receiver.next_event().await.unwrap(), Some(LiveEvent::SpeechStarted {id:Some(id)}) if id == "utterance-1")
    );
    assert!(
        matches!(session.receiver.next_event().await.unwrap(), Some(LiveEvent::TranscriptionFailed {id:Some(id),..}) if id == "utterance-1")
    );
    assert!(
        matches!(session.receiver.next_event().await.unwrap(), Some(LiveEvent::Transcript {id:Some(id),text,..}) if id == "utterance-2" && text == "still here")
    );
}

#[tokio::test]
async fn realtime_input_and_silent_context_have_distinct_wire_messages() {
    let fixture = SocketFixture::new(vec![json!({"setupComplete":{}})]);
    let session = LiveConfig::new(LiveProvider::Google, "test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    session
        .sender
        .send_text("background", Role::User, false)
        .await
        .unwrap();
    session
        .sender
        .send_realtime_text("user activity")
        .await
        .unwrap();
    let sent = fixture.sent.lock().unwrap();
    assert_eq!(sent[1]["clientContent"]["turnComplete"], false);
    assert_eq!(sent[2]["realtimeInput"]["text"], "user activity");
}

#[tokio::test]
async fn live_credentials_and_proxy_headers_reach_the_injected_transport() {
    let fixture = SocketFixture::new(vec![json!({"setupComplete":{}})]);
    let mut config = LiveConfig::new(LiveProvider::Google, "test", "short-lived-token");
    config.ephemeral = true;
    config
        .headers
        .insert("x-proxy-session".into(), "session-scope".into());
    let session = config.connect_with(&fixture).await.unwrap();
    let (url, headers) = fixture.connection.lock().unwrap().clone().unwrap();
    let url = reqwest::Url::parse(&url).unwrap();
    assert!(url.path().ends_with(".BidiGenerateContentConstrained"));
    assert!(
        url.query_pairs()
            .any(|(key, value)| key == "access_token" && value == "short-lived-token")
    );
    assert!(!url.query_pairs().any(|(key, _)| key == "key"));
    assert_eq!(headers["x-proxy-session"], "session-scope");
    session.sender.close().await.unwrap();
}

#[tokio::test]
async fn failed_or_abandoned_writes_never_poll_the_sink_again() {
    for abandoned in [false, true] {
        let mut fixture = SocketFixture::new(vec![json!({"setupComplete":{}})]);
        fixture.stay_open = true;
        fixture.fail_writes_after_setup = !abandoned;
        fixture.block_writes_after_setup = abandoned;
        let mut session = LiveConfig::new(LiveProvider::Google, "test", "key")
            .connect_with(&fixture)
            .await
            .unwrap();
        let sender = session.sender.clone();
        let (write, received) = tokio::join!(
            tokio::time::timeout(
                Duration::from_millis(10),
                sender.send_text("hello", Role::User, true)
            ),
            tokio::time::timeout(Duration::from_secs(1), session.receiver.next_event())
        );
        if abandoned {
            assert!(write.is_err());
        } else {
            assert!(write.unwrap().is_err());
        }
        assert!(received.unwrap().unwrap().is_none());
        assert!(
            sender
                .send_text("too late", Role::User, true)
                .await
                .is_err()
        );
        sender.close().await.unwrap();
        session.sender.close().await.unwrap();
        assert_eq!(fixture.sent.lock().unwrap().len(), 1);
    }
}

async fn usage_events(provider: LiveProvider, events: Vec<Value>) -> Vec<(String, Value)> {
    let fixture = SocketFixture::new(events);
    let mut session = LiveConfig::new(provider, "models/live-test", "key")
        .connect_with(&fixture)
        .await
        .unwrap();
    let mut usage = vec![];
    while let Some(events) = session.receiver.next_events().await.unwrap() {
        for event in events {
            if let LiveEvent::Usage {
                model,
                usage: value,
            } = event
            {
                usage.push((model, value));
            }
        }
    }
    usage
}
#[tokio::test]
async fn google_usage_metadata_is_reported_per_message_with_the_model() {
    let usage = usage_events(LiveProvider::Google, vec![
        json!({"setupComplete":{}}),
        json!({"serverContent":{"turnComplete":true},"usageMetadata":{"promptTokenCount":10,"responseTokenCount":4}}),
        json!({"serverContent":{"turnComplete":true}}),
        json!({"usageMetadata":{"promptTokenCount":30,"responseTokenCount":6}}),
    ])
    .await;
    assert_eq!(
        usage,
        vec![
            (
                "live-test".to_string(),
                json!({"promptTokenCount":10,"responseTokenCount":4})
            ),
            (
                "live-test".to_string(),
                json!({"promptTokenCount":30,"responseTokenCount":6})
            ),
        ]
    );
}
#[tokio::test]
async fn openai_usage_covers_cancelled_responses_and_input_transcription() {
    let usage = usage_events(LiveProvider::Openai, vec![
        json!({"type":"session.updated"}),
        json!({"type":"response.created"}),
        json!({"type":"response.done","response":{"status":"cancelled","usage":{"input_tokens":5,"output_tokens":1}}}),
        json!({"type":"conversation.item.input_audio_transcription.completed","item_id":"u","transcript":"hi","usage":{"type":"tokens","input_tokens":3,"output_tokens":1}}),
        json!({"type":"response.created"}),
        json!({"type":"response.done","response":{"status":"completed","usage":null}}),
    ])
    .await;
    assert_eq!(
        usage,
        vec![
            (
                "live-test".to_string(),
                json!({"input_tokens":5,"output_tokens":1})
            ),
            (
                "gpt-4o-mini-transcribe".to_string(),
                json!({"type":"tokens","input_tokens":3,"output_tokens":1})
            ),
        ]
    );
}
