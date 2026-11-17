use aiwrapper::{live::*, speech::*, speech_stream::*, *};
use async_trait::async_trait;
use futures_util::{StreamExt, stream::BoxStream};
use serde_json::json;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

async fn next(session: &mut LiveSession) -> Vec<LiveEvent> {
    tokio::time::timeout(Duration::from_secs(3), session.receiver.next_events())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}
async fn synthesized(session: &mut LiveSession) {
    loop {
        if next(session).await.iter().any(
            |e| matches!(e,LiveEvent::ProviderState{state} if state["kind"]=="synthesis-complete"),
        ) {
            break;
        }
    }
}

#[tokio::test]
async fn playback_cut_keeps_only_fully_heard_segments_and_cannot_replay_raw_text() {
    let seen = Arc::new(Mutex::new(vec![]));
    let requests = seen.clone();
    let language = MockLang::from_fn(move |conversation, _| {
        requests.lock().unwrap().push(conversation.clone());
        let mut m = Message::assistant("Heard. Unheard.");
        m.meta = Some(json!({"anthropicContent":[{"type":"text","text":"Heard. Unheard."}]}));
        Ok(m)
    });
    let mut session = CascadeConfig::new(Arc::new(language), Arc::new(MockSpeechOutput))
        .connect()
        .unwrap();
    session.sender.send_realtime_text("hello").await.unwrap();
    let mut first = None;
    loop {
        let events = next(&mut session).await;
        for event in &events {
            if let LiveEvent::Audio {
                item_id,
                content_index: Some(0),
                ..
            } = event
            {
                first = item_id.clone();
            }
        }
        if events.iter().any(
            |e| matches!(e,LiveEvent::ProviderState{state} if state["kind"]=="synthesis-complete"),
        ) {
            break;
        }
    }
    session
        .sender
        .truncate_audio(first.as_ref().unwrap(), 0, 200)
        .await
        .unwrap();
    session.sender.interrupt().await.unwrap();
    session.sender.send_realtime_text("continue").await.unwrap();
    synthesized(&mut session).await;
    {
        let requests = seen.lock().unwrap();
        let previous = &requests[1].messages[1];
        assert_eq!(previous.answer(), "Heard.");
        assert!(
            !serde_json::to_string(&previous.meta)
                .unwrap()
                .contains("Unheard")
        );
    }
    session.sender.close().await.unwrap();
}

struct GatedLanguage {
    gate: CancellationToken,
}

struct PartialWordLanguage(CancellationToken);
#[async_trait]
impl LanguageProvider for PartialWordLanguage {
    async fn complete(
        &self,
        _: &Conversation,
        options: &ChatOptions,
        update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<Message> {
        update(&Message::assistant(
            "This is a complete opening phrase and you look contempl",
        ));
        tokio::select! {_=self.0.cancelled()=>{},_=options.cancellation.cancelled()=>return Err(Error::Cancelled)};
        Ok(Message::assistant(
            "This is a complete opening phrase and you look contemplative.",
        ))
    }
}
struct RecordedSpeech(Arc<Mutex<Vec<String>>>);
#[async_trait]
impl SpeechOutput for RecordedSpeech {
    async fn synthesize(
        &self,
        text: &str,
        cancellation: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>> {
        self.0.lock().unwrap().push(text.into());
        MockSpeechOutput.synthesize(text, cancellation).await
    }
}
#[tokio::test]
async fn timer_streams_complete_words_and_reports_exact_synthesis_input() {
    let gate = CancellationToken::new();
    let inputs = Arc::new(Mutex::new(vec![]));
    let mut session = CascadeConfig::new(
        Arc::new(PartialWordLanguage(gate.clone())),
        Arc::new(RecordedSpeech(inputs.clone())),
    )
    .connect()
    .unwrap();
    session.sender.send_realtime_text("hi").await.unwrap();
    let mut reported = vec![];
    loop {
        let events = next(&mut session).await;
        let mut done = false;
        for event in events {
            if let LiveEvent::ProviderState { state } = event {
                if state["kind"] == "tts-input" {
                    reported.push(state["text"].as_str().unwrap().to_owned());
                }
                if state["kind"] == "segment-done" && state["contentIndex"] == 0 {
                    assert_eq!(
                        inputs.lock().unwrap().as_slice(),
                        ["This is a complete opening phrase and you look "]
                    );
                    assert!(!gate.is_cancelled());
                    gate.cancel();
                }
                done |= state["kind"] == "synthesis-complete";
            }
        }
        if done {
            break;
        }
    }
    assert_eq!(
        inputs.lock().unwrap().as_slice(),
        [
            "This is a complete opening phrase and you look ",
            "contemplative."
        ]
    );
    assert_eq!(reported, *inputs.lock().unwrap());
    session.sender.close().await.unwrap();
}

struct PendingFirstReply {
    started: CancellationToken,
    requests: Arc<Mutex<Vec<Conversation>>>,
}
#[async_trait]
impl LanguageProvider for PendingFirstReply {
    async fn complete(
        &self,
        conversation: &Conversation,
        options: &ChatOptions,
        _: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<Message> {
        let first = {
            let mut requests = self.requests.lock().unwrap();
            requests.push(conversation.clone());
            requests.len() == 1
        };
        if first {
            self.started.cancel();
            options.cancellation.cancelled().await;
            return Err(Error::Cancelled);
        }
        Ok(Message::assistant("Still listening."))
    }
}
#[tokio::test]
async fn interrupt_before_first_token_does_not_replay_an_empty_assistant() {
    let started = CancellationToken::new();
    let requests = Arc::new(Mutex::new(vec![]));
    let mut session = CascadeConfig::new(
        Arc::new(PendingFirstReply {
            started: started.clone(),
            requests: requests.clone(),
        }),
        Arc::new(MockSpeechOutput),
    )
    .connect()
    .unwrap();
    session.sender.send_realtime_text("first").await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), started.cancelled())
        .await
        .unwrap();
    session.sender.interrupt().await.unwrap();
    session.sender.send_realtime_text("second").await.unwrap();
    synthesized(&mut session).await;
    {
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[1].messages.len(), 2);
        assert!(requests[1].messages.iter().all(|m| m.role == Role::User));
    }
    session.sender.close().await.unwrap();
}
#[async_trait]
impl LanguageProvider for GatedLanguage {
    async fn complete(
        &self,
        _: &Conversation,
        options: &ChatOptions,
        update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<Message> {
        update(&Message::assistant("First sentence. "));
        tokio::select! {_=self.gate.cancelled()=>{},_=options.cancellation.cancelled()=>return Err(Error::Cancelled)};
        Ok(Message::assistant("First sentence. Last sentence."))
    }
}
#[tokio::test]
async fn speech_streams_before_language_completion_and_stop_discards_buffered_audio() {
    let gate = CancellationToken::new();
    let mut session = CascadeConfig::new(
        Arc::new(GatedLanguage { gate: gate.clone() }),
        Arc::new(MockSpeechOutput),
    )
    .connect()
    .unwrap();
    session.sender.send_realtime_text("hi").await.unwrap();
    loop {
        if next(&mut session)
            .await
            .iter()
            .any(|e| matches!(e, LiveEvent::Audio { .. }))
        {
            break;
        }
    }
    assert!(!gate.is_cancelled());
    session.sender.interrupt().await.unwrap();
    gate.cancel();
    loop {
        let events = next(&mut session).await;
        assert!(!events.iter().any(|e| matches!(e, LiveEvent::Audio { .. })));
        if events.iter().any(|e| matches!(e, LiveEvent::Interrupted)) {
            break;
        }
    }
    session.sender.close().await.unwrap();
}
#[tokio::test]
async fn live_agent_executes_a_cascade_tool_and_continues_once() {
    let tool = Tool::new("add", "add", json!({"type":"object"}), |_, _| async {
        Ok(json!(5))
    });
    let mut config = CascadeConfig::new(
        Arc::new(MockLang::interactive()),
        Arc::new(MockSpeechOutput),
    );
    config.tools = vec![tool.definition.clone()];
    let mut agent =
        LiveAgent::new(config.connect().unwrap(), vec![tool], Default::default()).unwrap();
    agent
        .sender()
        .send_realtime_text("tool: add {}")
        .await
        .unwrap();
    let mut results = 0;
    let mut answer = false;
    tokio::time::timeout(Duration::from_secs(3), async {
        while let Some(events) = agent.next_events().await.unwrap() {
            for event in events {
                match event {
                    LiveAgentEvent::ToolResult { .. } => results += 1,
                    LiveAgentEvent::Model {
                        event:
                            LiveEvent::Transcript {
                                input: false, text, ..
                            },
                    } if text.contains('5') => answer = true,
                    _ => {}
                }
            }
            if answer && results == 1 {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert!(answer);
    assert_eq!(results, 1);
    agent.close().await.unwrap();
}
#[tokio::test]
async fn dropping_receiver_cancels_clones_without_cancelling_parent() {
    let parent = CancellationToken::new();
    let mut config = CascadeConfig::new(
        Arc::new(MockLang::interactive()),
        Arc::new(MockSpeechOutput),
    );
    config.cancellation = parent.clone();
    let session = config.connect().unwrap();
    let sender = session.sender.clone();
    drop(session.receiver);
    assert!(matches!(
        sender.send_realtime_text("late").await,
        Err(Error::Cancelled)
    ));
    assert!(!parent.is_cancelled());
}
struct BrokenSpeech;
#[async_trait]
impl SpeechOutput for BrokenSpeech {
    async fn synthesize(
        &self,
        _: &str,
        _: CancellationToken,
    ) -> Result<BoxStream<'static, Result<PcmFrame>>> {
        Ok(
            futures_util::stream::once(async { Err(Error::Protocol("speech failed".into())) })
                .boxed(),
        )
    }
}
#[tokio::test]
async fn asynchronous_speech_failure_reaches_receiver() {
    let mut s = CascadeConfig::new(Arc::new(MockLang::interactive()), Arc::new(BrokenSpeech))
        .connect()
        .unwrap();
    s.sender.send_realtime_text("hello").await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match s.receiver.next_events().await {
                Err(e) => {
                    assert!(e.to_string().contains("speech failed"));
                    break;
                }
                Ok(Some(_)) => {}
                Ok(None) => panic!("failure lost"),
            }
        }
    })
    .await
    .unwrap();
}

struct NoInput;
#[async_trait]
impl SpeechInput for NoInput {
    fn sample_rate(&self) -> u32 {
        24000
    }
    async fn append(&self, _: &PcmFrame) -> Result<()> {
        Ok(())
    }
    async fn end_turn(&self) -> Result<()> {
        Ok(())
    }
}
#[tokio::test]
async fn duplicate_transcription_finals_do_not_start_another_response() {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = calls.clone();
    let mut config = CascadeConfig::new(
        Arc::new(MockLang::from_fn(move |_, _| {
            count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(Message::assistant("Hello."))
        })),
        Arc::new(MockSpeechOutput),
    );
    let (tx, rx) = tokio::sync::mpsc::channel(8);
    config.transcription = Some(TranscriptionSession {
        input: Arc::new(NoInput),
        events: futures_util::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|v| (v, rx))
        })
        .boxed(),
    });
    let mut s = config.connect().unwrap();
    for committed in [false, true, true] {
        tx.send(Ok(TranscriptionEvent::Transcript {
            id: "1".into(),
            text: "hello".into(),
            committed,
        }))
        .await
        .unwrap();
    }
    synthesized(&mut s).await;
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    s.sender.close().await.unwrap();
}
#[tokio::test]
async fn a_cut_waits_for_actual_tool_results_before_requesting_the_next_turn() {
    let mut first = Message::assistant("Let me check.");
    first.items.push(Item::Tool {
        call_id: "call-1".into(),
        name: "lookup".into(),
        arguments: json!({}),
        thought_signature: None,
    });
    let mut s = CascadeConfig::new(
        Arc::new(MockLang::new([first, Message::assistant("Next answer.")])),
        Arc::new(MockSpeechOutput),
    )
    .connect()
    .unwrap();
    s.sender.send_realtime_text("first").await.unwrap();
    loop {
        if next(&mut s)
            .await
            .iter()
            .any(|e| matches!(e, LiveEvent::ToolCall { .. }))
        {
            break;
        }
    }
    s.sender.send_realtime_text("new question").await.unwrap();
    s.sender
        .send_tool_results(&[LiveToolResult {
            call_id: "call-1".into(),
            name: "lookup".into(),
            result: json!("actual result"),
            images: vec![],
        }])
        .await
        .unwrap();
    synthesized(&mut s).await;
    s.sender.close().await.unwrap();
}
#[tokio::test]
async fn invalid_result_batch_is_atomic() {
    let first = Message::new(
        Role::Assistant,
        vec![Item::Tool {
            call_id: "one".into(),
            name: "lookup".into(),
            arguments: json!({}),
            thought_signature: None,
        }],
    );
    let mut s = CascadeConfig::new(
        Arc::new(MockLang::new([first, Message::assistant("Done.")])),
        Arc::new(MockSpeechOutput),
    )
    .connect()
    .unwrap();
    s.sender.send_realtime_text("first").await.unwrap();
    loop {
        if next(&mut s)
            .await
            .iter()
            .any(|e| matches!(e, LiveEvent::ToolCall { .. }))
        {
            break;
        }
    }
    let valid = LiveToolResult {
        call_id: "one".into(),
        name: "lookup".into(),
        result: json!(5),
        images: vec![],
    };
    let mut invalid = valid.clone();
    invalid.call_id = "unknown".into();
    assert!(
        s.sender
            .send_tool_results(&[valid.clone(), invalid])
            .await
            .is_err()
    );
    s.sender.send_tool_results(&[valid]).await.unwrap();
    synthesized(&mut s).await;
    s.sender.close().await.unwrap();
}

struct BurstLanguage;
#[async_trait]
impl LanguageProvider for BurstLanguage {
    async fn complete(
        &self,
        _: &Conversation,
        _: &ChatOptions,
        update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<Message> {
        for n in 0..1000 {
            update(&Message::assistant("x".repeat(n)));
        }
        Ok(Message::assistant("done"))
    }
}
#[tokio::test]
async fn a_synchronous_model_burst_fails_visibly_instead_of_hanging_or_growing_a_queue() {
    let mut s = CascadeConfig::new(Arc::new(BurstLanguage), Arc::new(MockSpeechOutput))
        .connect()
        .unwrap();
    s.sender.send_realtime_text("hello").await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match s.receiver.next_events().await {
                Err(e) => {
                    assert!(e.to_string().contains("overflow"));
                    break;
                }
                Ok(Some(_)) => {}
                Ok(None) => panic!("overflow was hidden"),
            }
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn tool_followup_waits_for_preamble_playback_instead_of_cutting_it_off() {
    let first = Message::new(
        Role::Assistant,
        vec![
            Item::Text {
                text: "Checking.".into(),
            },
            Item::Tool {
                call_id: "one".into(),
                name: "lookup".into(),
                arguments: json!({}),
                thought_signature: None,
            },
        ],
    );
    let mut s = CascadeConfig::new(
        Arc::new(MockLang::new([first, Message::assistant("Done.")])),
        Arc::new(MockSpeechOutput),
    )
    .connect()
    .unwrap();
    s.sender.send_realtime_text("hello").await.unwrap();
    let mut item = None;
    loop {
        let events = next(&mut s).await;
        for e in &events {
            if let LiveEvent::Audio { item_id, .. } = e {
                item = item_id.clone();
            }
        }
        if events.iter().any(
            |e| matches!(e,LiveEvent::ProviderState{state} if state["kind"]=="synthesis-complete"),
        ) {
            break;
        }
    }
    s.sender
        .send_tool_results(&[LiveToolResult {
            call_id: "one".into(),
            name: "lookup".into(),
            result: json!(5),
            images: vec![],
        }])
        .await
        .unwrap();
    // Drain diagnostics while proving that no next response starts before a cursor.
    let premature = tokio::time::timeout(Duration::from_millis(30), async {
        loop {
            if next(&mut s)
                .await
                .iter()
                .any(|e| matches!(e, LiveEvent::ResponseStarted))
            {
                return;
            }
        }
    })
    .await;
    assert!(premature.is_err());
    s.sender
        .truncate_audio(item.as_ref().unwrap(), 0, 200)
        .await
        .unwrap();
    synthesized(&mut s).await;
    s.sender.close().await.unwrap();
}

#[tokio::test]
async fn camera_batch_is_frozen_through_tools_and_old_payloads_are_pruned() {
    let seen = Arc::new(Mutex::new(vec![]));
    let requests = seen.clone();
    let language = MockLang::from_fn(move |conversation, _| {
        let mut requests = requests.lock().unwrap();
        requests.push(conversation.clone());
        if requests.len() == 1 {
            Ok(Message::new(
                Role::Assistant,
                vec![Item::Tool {
                    call_id: "camera-tool".into(),
                    name: "lookup".into(),
                    arguments: json!({}),
                    thought_signature: None,
                }],
            ))
        } else {
            Ok(Message::assistant("Done."))
        }
    });
    let mut config = CascadeConfig::new(Arc::new(language), Arc::new(MockSpeechOutput));
    config.camera_context = CameraContext::Recent;
    config.conversation.messages.push(Message::new(
        Role::User,
        vec![Item::Image {
            url: Some("https://example.com/reference.png".into()),
            base64: None,
            mime_type: None,
        }],
    ));
    let mut session = config.connect().unwrap();
    let frame = |id| CameraFrame {
        id,
        captured_at_ms: id * 1000,
        image: LiveImage {
            data: "YWJj".into(),
            mime_type: "image/jpeg".into(),
        },
    };
    for id in 1..=3 {
        session
            .sender
            .append_camera_frame(&frame(id))
            .await
            .unwrap();
    }
    session
        .sender
        .send_realtime_text("First view")
        .await
        .unwrap();
    loop {
        if next(&mut session)
            .await
            .iter()
            .any(|e| matches!(e, LiveEvent::ToolCall { .. }))
        {
            break;
        }
    }
    // Arrives while the tool is running: this must not change its continuation.
    session.sender.append_camera_frame(&frame(4)).await.unwrap();
    session
        .sender
        .send_tool_results(&[LiveToolResult {
            call_id: "camera-tool".into(),
            name: "lookup".into(),
            result: json!("actual"),
            images: vec![],
        }])
        .await
        .unwrap();
    synthesized(&mut session).await;
    session
        .sender
        .send_realtime_text("Next view")
        .await
        .unwrap();
    synthesized(&mut session).await;
    {
        let requests = seen.lock().unwrap();
        assert_eq!(requests.len(), 3);
        for request in &requests[..2] {
            let user = request
                .messages
                .iter()
                .rev()
                .find(|m| m.role == Role::User)
                .unwrap();
            assert_eq!(
                user.items
                    .iter()
                    .filter(|i| matches!(i, Item::Image { .. }))
                    .count(),
                3
            );
            assert_eq!(
                user.meta.as_ref().unwrap()["cascadeCamera"]["frames"][2]["id"],
                3
            );
        }
        let last = &requests[2];
        assert!(matches!(
            last.messages[0].items[0],
            Item::Image { url: Some(_), .. }
        ));
        assert_eq!(
            last.messages[1].items,
            vec![Item::Text {
                text: "First view".into()
            }]
        );
        let user = last
            .messages
            .iter()
            .rev()
            .find(|m| m.role == Role::User)
            .unwrap();
        assert_eq!(
            user.items
                .iter()
                .filter(|i| matches!(i, Item::Image { .. }))
                .count(),
            1
        );
        assert_eq!(
            user.meta.as_ref().unwrap()["cascadeCamera"]["frames"][0]["id"],
            4
        );
    }
    session.sender.close().await.unwrap();
}
