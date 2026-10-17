use aiwrapper::{live::*, *};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::mpsc;

struct Fixture {
    input: Mutex<Option<mpsc::Receiver<Value>>>,
    sent: Arc<Mutex<Vec<Value>>>,
    fail_results: bool,
    stall: Option<(CancellationToken, CancellationToken)>,
}
#[async_trait]
impl LiveTransport for Fixture {
    async fn connect(&self, _: String, _: BTreeMap<String, String>) -> Result<LiveSocket> {
        let sent = self.sent.clone();
        let fail_results = self.fail_results;
        let stall = self.stall.clone();
        Ok(LiveSocket {
            sender: Box::pin(futures_util::sink::unfold(
                sent,
                move |sent, value: Value| {
                    let stall = stall.clone();
                    async move {
                        if fail_results && value.get("toolResponse").is_some() {
                            return Err(Error::Protocol("fixture result delivery failed".into()));
                        }
                        if (value.get("realtimeInput").is_some()
                            || value["type"] == "response.create")
                            && let Some((started, release)) = stall
                        {
                            started.cancel();
                            release.cancelled().await;
                        }
                        sent.lock().unwrap().push(value);
                        Ok::<_, Error>(sent)
                    }
                },
            )),
            receiver:
                futures_util::stream::unfold(
                    self.input.lock().unwrap().take().unwrap(),
                    |mut receiver| async move {
                        receiver.recv().await.map(|value| (Ok(value), receiver))
                    },
                )
                .boxed(),
        })
    }
}
async fn connect(config: LiveConfig) -> (LiveSession, mpsc::Sender<Value>, Arc<Mutex<Vec<Value>>>) {
    connect_with_behavior(config, false, None).await
}
async fn connect_with_behavior(
    config: LiveConfig,
    fail_results: bool,
    stall: Option<(CancellationToken, CancellationToken)>,
) -> (LiveSession, mpsc::Sender<Value>, Arc<Mutex<Vec<Value>>>) {
    let (input, receiver) = mpsc::channel(16);
    input
        .send(if config.provider == LiveProvider::Google {
            json!({"setupComplete":{}})
        } else {
            json!({"type":"session.updated"})
        })
        .await
        .unwrap();
    let sent = Arc::new(Mutex::new(vec![]));
    let fixture = Fixture {
        input: Mutex::new(Some(receiver)),
        sent: sent.clone(),
        fail_results,
        stall,
    };
    (config.connect_with(&fixture).await.unwrap(), input, sent)
}
fn config(tools: &[Tool]) -> LiveConfig {
    let mut config = LiveConfig::new(LiveProvider::Google, "fixture", "key");
    config.tools = tools.iter().map(|tool| tool.definition.clone()).collect();
    config
}
fn call(id: &str) -> Value {
    json!({"toolCall":{"functionCalls":[{"id":id,"name":"work","args":{}}]}})
}
async fn next(agent: &mut LiveAgent) -> Vec<LiveAgentEvent> {
    tokio::time::timeout(Duration::from_secs(2), agent.next_events())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}
async fn completed(agent: &mut LiveAgent, id: &str) -> LiveToolResult {
    loop {
        for event in next(agent).await {
            if let LiveAgentEvent::ToolResult { result, .. } = event
                && result.call_id == id
            {
                return result;
            }
        }
    }
}
fn slow_tool(gate: CancellationToken, count: Arc<AtomicUsize>) -> Tool {
    Tool::new("work", "Work", json!({"type":"object"}), move |_, _| {
        let gate = gate.clone();
        let count = count.clone();
        async move {
            count.fetch_add(1, Ordering::SeqCst);
            gate.cancelled().await;
            tool_content(vec![
                json!({"type":"text","text":"42"}),
                json!({"type":"image","mimeType":"image/png","base64":"cGlj"}),
            ])
        }
    })
}
#[tokio::test]
async fn slow_tools_leave_audio_and_cancellation_live_and_keep_execution_order() {
    let gate = CancellationToken::new();
    let count = Arc::new(AtomicUsize::new(0));
    let tools = vec![slow_tool(gate.clone(), count.clone())];
    let (session, input, sent) = connect(config(&tools)).await;
    let stored = Arc::new(Mutex::new(vec![]));
    let options = LiveAgentOptions {
        on_tool_result: Some(Arc::new({
            let stored = stored.clone();
            move |outcome| {
                let result = outcome.result;
                let stored = stored.clone();
                Box::pin(async move {
                    stored.lock().unwrap().push(result);
                    Ok(())
                })
            }
        })),
        ..Default::default()
    };
    let mut agent = LiveAgent::new(session, tools, options).unwrap();
    input.send(call("first")).await.unwrap();
    next(&mut agent).await;
    input.send(call("second")).await.unwrap();
    next(&mut agent).await;
    input.send(json!({"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQD//w=="}}]}}})).await.unwrap();
    assert!(next(&mut agent).await.iter().any(|event| matches!(
        event,
        LiveAgentEvent::Model {
            event: LiveEvent::Audio { .. }
        }
    )));
    input
        .send(json!({"toolCallCancellation":{"ids":["second"]}}))
        .await
        .unwrap();
    assert!(next(&mut agent).await.iter().any(|event| matches!(
        event,
        LiveAgentEvent::Model {
            event: LiveEvent::ToolsCancelled { .. }
        }
    )));
    gate.cancel();
    let first = completed(&mut agent, "first").await;
    assert_eq!(first.images.len(), 1);
    let second = completed(&mut agent, "second").await;
    assert_eq!(second.result["cancelled"], true);
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert_eq!(stored.lock().unwrap().len(), 2);
    let responses: Vec<_> = sent
        .lock()
        .unwrap()
        .iter()
        .filter_map(|v| v.get("toolResponse").cloned())
        .collect();
    assert_eq!(responses.len(), 1);
    assert_eq!(responses[0]["functionResponses"][0]["id"], "first");
    assert_eq!(
        responses[0]["functionResponses"][0]["parts"][0]["inlineData"]["data"],
        "cGlj"
    );
    agent.close().await.unwrap();
}
#[tokio::test]
async fn a_running_tool_moves_to_its_matching_resumed_connection_without_reexecution() {
    let gate = CancellationToken::new();
    let count = Arc::new(AtomicUsize::new(0));
    let tools = vec![slow_tool(gate.clone(), count.clone())];
    let (session, input, old_sent) = connect(config(&tools)).await;
    let mut agent = LiveAgent::new(session, tools.clone(), Default::default()).unwrap();
    input.send(call("pending")).await.unwrap();
    next(&mut agent).await;
    input
        .send(json!({"sessionResumptionUpdate":{"resumable":true,"newHandle":"handle"}}))
        .await
        .unwrap();
    next(&mut agent).await;
    let mut resumed = config(&tools);
    resumed.resumption = agent.sender().resumption().await;
    resumed
        .settings
        .insert("sessionResumption".into(), json!({"handle":"handle"}));
    let (replacement, _new_input, new_sent) = connect(resumed).await;
    agent.replace(replacement, tools).await.unwrap();
    gate.cancel();
    completed(&mut agent, "pending").await;
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert!(
        !old_sent
            .lock()
            .unwrap()
            .iter()
            .any(|v| v.get("toolResponse").is_some())
    );
    assert!(
        new_sent
            .lock()
            .unwrap()
            .iter()
            .any(|v| v["toolResponse"]["functionResponses"][0]["id"] == "pending")
    );
    agent.close().await.unwrap();
}
#[tokio::test]
async fn a_fresh_connection_fences_late_results_and_scopes_reused_call_ids() {
    let gate = CancellationToken::new();
    let started = CancellationToken::new();
    let count = Arc::new(AtomicUsize::new(0));
    let tools = vec![Tool::new("work", "Work", json!({"type":"object"}), {
        let gate = gate.clone();
        let started = started.clone();
        let count = count.clone();
        move |_, ctx| {
            let gate = gate.clone();
            let started = started.clone();
            let count = count.clone();
            async move {
                let index = count.fetch_add(1, Ordering::SeqCst);
                started.cancel();
                gate.cancelled().await;
                assert_eq!(ctx.cancellation.is_cancelled(), index == 0);
                Ok(json!({"written":true}))
            }
        }
    })];
    let (session, input, old_sent) = connect(config(&tools)).await;
    let saved = Arc::new(Mutex::new(vec![]));
    let options = LiveAgentOptions {
        on_tool_result: Some(Arc::new({
            let saved = saved.clone();
            move |outcome| {
                let generation = outcome.generation;
                let value = outcome.result;
                let saved = saved.clone();
                Box::pin(async move {
                    saved.lock().unwrap().push((generation, value));
                    Ok(())
                })
            }
        })),
        ..Default::default()
    };
    let mut agent = LiveAgent::new(session, tools.clone(), options).unwrap();
    input.send(call("reused")).await.unwrap();
    next(&mut agent).await;
    started.cancelled().await;
    let (replacement, new_input, new_sent) = connect(config(&tools)).await;
    agent.replace(replacement, tools).await.unwrap();
    new_input.send(call("reused")).await.unwrap();
    loop {
        if next(&mut agent).await.iter().any(|event| {
            matches!(
                event,
                LiveAgentEvent::Model {
                    event: LiveEvent::ToolCall { .. }
                }
            )
        }) {
            break;
        }
    }
    gate.cancel();
    let mut completed_generations = vec![];
    while completed_generations.len() < 2 {
        for event in next(&mut agent).await {
            if let LiveAgentEvent::ToolResult {
                generation, result, ..
            } = event
            {
                assert_eq!(result.result["written"], true);
                completed_generations.push(generation);
            }
        }
    }
    assert_eq!(completed_generations, [0, 1]);
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert_eq!(
        saved
            .lock()
            .unwrap()
            .iter()
            .map(|(generation, _)| *generation)
            .collect::<Vec<_>>(),
        [0, 1]
    );
    assert!(
        !old_sent
            .lock()
            .unwrap()
            .iter()
            .any(|v| v.get("toolResponse").is_some())
    );
    assert_eq!(
        new_sent
            .lock()
            .unwrap()
            .iter()
            .filter(|v| v.get("toolResponse").is_some())
            .count(),
        1
    );
    agent.close().await.unwrap();
}

#[tokio::test]
async fn cancelled_receive_poll_retains_the_incoming_provider_message() {
    let started = CancellationToken::new();
    let release = CancellationToken::new();
    let (mut session, input, _) =
        connect_with_behavior(config(&[]), false, Some((started.clone(), release.clone()))).await;
    // First poll reaches the socket before the concurrent sender takes the lock.
    let mut receiving = Box::pin(session.receiver.next_events());
    assert!(futures_util::poll!(&mut receiving).is_pending());
    let sender = session.sender.clone();
    let writing = tokio::spawn(async move { sender.append_image("cGlj", "image/png").await });
    started.cancelled().await;
    input.send(json!({"serverContent":{"modelTurn":{"parts":[{"text":"retained"}]},"turnComplete":true}})).await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut receiving)
            .await
            .is_err()
    );
    drop(receiving);
    release.cancel();
    writing.await.unwrap().unwrap();
    let events = tokio::time::timeout(Duration::from_secs(1), session.receiver.next_events())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        matches!(events.as_slice(), [LiveEvent::ResponseStarted, LiveEvent::Transcript { text, .. }, LiveEvent::ResponseEnded] if text == "retained")
    );
    session.sender.close().await.unwrap();
}

#[tokio::test]
async fn persistence_failure_stops_further_side_effects_and_model_delivery() {
    let release = CancellationToken::new();
    let count = Arc::new(AtomicUsize::new(0));
    let tools = vec![slow_tool(release.clone(), count.clone())];
    let (session, input, sent) = connect(config(&tools)).await;
    let options = LiveAgentOptions {
        on_tool_result: Some(Arc::new(|_| {
            Box::pin(async { Err(Error::Tool("storage failed".into())) })
        })),
        ..Default::default()
    };
    let mut agent = LiveAgent::new(session, tools, options).unwrap();
    input.send(call("first")).await.unwrap();
    next(&mut agent).await;
    input.send(call("second")).await.unwrap();
    next(&mut agent).await;
    release.cancel();
    let error = agent.next_events().await.unwrap_err();
    assert!(error.to_string().contains("storage failed"));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert!(
        !sent
            .lock()
            .unwrap()
            .iter()
            .any(|v| v.get("toolResponse").is_some())
    );
    assert!(
        agent
            .close()
            .await
            .unwrap_err()
            .to_string()
            .contains("storage failed")
    );
}

#[tokio::test]
async fn unoffered_handlers_are_not_executed_and_invalid_arguments_are_results() {
    let count = Arc::new(AtomicUsize::new(0));
    let tools = vec![Tool::new(
        "work",
        "Work",
        json!({"type":"object","required":["value"]}),
        {
            let count = count.clone();
            move |_, _| {
                count.fetch_add(1, Ordering::SeqCst);
                async { Ok(json!(42)) }
            }
        },
    )];
    let (session, input, _) = connect(config(&[])).await;
    let mut agent = LiveAgent::new(session, tools.clone(), Default::default()).unwrap();
    input.send(call("disabled")).await.unwrap();
    let disabled = completed(&mut agent, "disabled").await;
    assert!(
        disabled.result["error"]
            .as_str()
            .unwrap()
            .contains("disabled")
    );
    let (replacement, input, _) = connect(config(&tools)).await;
    agent.replace(replacement, tools).await.unwrap();
    input.send(call("invalid")).await.unwrap();
    let invalid = completed(&mut agent, "invalid").await;
    assert!(invalid.result["error"].as_str().unwrap().contains("value"));
    assert_eq!(count.load(Ordering::SeqCst), 0);
    agent.close().await.unwrap();
}

#[tokio::test]
async fn failed_delivery_retries_the_saved_result_on_resumption_without_rerunning() {
    let count = Arc::new(AtomicUsize::new(0));
    let gate = CancellationToken::new();
    gate.cancel();
    let tools = vec![slow_tool(gate, count.clone())];
    let (session, input, _) = connect_with_behavior(config(&tools), true, None).await;
    let mut agent = LiveAgent::new(session, tools.clone(), Default::default()).unwrap();
    input
        .send(json!({"sessionResumptionUpdate":{"resumable":true,"newHandle":"handle"}}))
        .await
        .unwrap();
    next(&mut agent).await;
    input.send(call("retry")).await.unwrap();
    loop {
        let result = tokio::time::timeout(Duration::from_secs(1), agent.next_events())
            .await
            .unwrap();
        if let Ok(Some(events)) = result
            && events
                .iter()
                .any(|e| matches!(e, LiveAgentEvent::ToolDeliveryFailed { .. }))
        {
            break;
        }
    }
    let mut resumed = config(&tools);
    resumed.resumption = agent.sender().resumption().await;
    resumed
        .settings
        .insert("sessionResumption".into(), json!({"handle":"handle"}));
    let (replacement, _input, sent) = connect(resumed).await;
    agent.replace(replacement, tools).await.unwrap();
    // The retry notification wakes the worker without another provider message.
    next(&mut agent).await;
    assert_eq!(count.load(Ordering::SeqCst), 1);
    {
        let sent = sent.lock().unwrap();
        let responses: Vec<_> = sent.iter().filter_map(|v| v.get("toolResponse")).collect();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["functionResponses"][0]["id"], "retry");
        assert_eq!(
            responses[0]["functionResponses"][0]["parts"][0]["inlineData"]["data"],
            "cGlj"
        );
    }
    agent.close().await.unwrap();
}

#[tokio::test]
async fn pending_tools_have_a_bounded_queue() {
    let gate = CancellationToken::new();
    let count = Arc::new(AtomicUsize::new(0));
    let tools = vec![slow_tool(gate.clone(), count.clone())];
    let (session, input, _) = connect(config(&tools)).await;
    let mut agent = LiveAgent::new(
        session,
        tools,
        LiveAgentOptions {
            max_pending_tools: 1,
            ..Default::default()
        },
    )
    .unwrap();
    input.send(call("first")).await.unwrap();
    next(&mut agent).await;
    input.send(call("overflow")).await.unwrap();
    assert!(
        agent
            .next_events()
            .await
            .unwrap_err()
            .to_string()
            .contains("capacity")
    );
    gate.cancel();
    agent.close().await.unwrap();
    assert!(count.load(Ordering::SeqCst) <= 1);
}

#[tokio::test]
async fn a_cancelled_poll_does_not_suspend_provider_continuation_with_the_send_lock() {
    let started = CancellationToken::new();
    let release = CancellationToken::new();
    let config = LiveConfig::new(LiveProvider::Openai, "fixture", "key");
    let (mut session, input, _) =
        connect_with_behavior(config, false, Some((started.clone(), release.clone()))).await;
    input
        .send(json!({"type":"response.created"}))
        .await
        .unwrap();
    session.receiver.next_events().await.unwrap();
    input.send(json!({"type":"response.function_call_arguments.done","call_id":"pending","name":"work","arguments":"{}"})).await.unwrap();
    session.receiver.next_events().await.unwrap();
    session
        .sender
        .send_tool_results(&[LiveToolResult {
            call_id: "pending".into(),
            name: "work".into(),
            result: json!(42),
            images: vec![],
        }])
        .await
        .unwrap();
    input
        .send(json!({"type":"response.done","response":{"status":"completed"}}))
        .await
        .unwrap();
    let mut receiving = Box::pin(session.receiver.next_events());
    assert!(futures_util::poll!(&mut receiving).is_pending());
    started.cancelled().await;
    drop(receiving);
    release.cancel();
    tokio::time::timeout(
        Duration::from_secs(1),
        session.sender.send_text("context", Role::User, false),
    )
    .await
    .unwrap()
    .unwrap();
    let events = session.receiver.next_events().await.unwrap().unwrap();
    assert!(matches!(events.as_slice(), [LiveEvent::ResponseEnded]));
    session.sender.close().await.unwrap();
}

#[tokio::test]
async fn call_persistence_must_succeed_before_a_handler_can_run() {
    let gate = CancellationToken::new();
    gate.cancel();
    let count = Arc::new(AtomicUsize::new(0));
    let tools = vec![slow_tool(gate, count.clone())];
    let (session, input, sent) = connect(config(&tools)).await;
    let mut agent = LiveAgent::new(
        session,
        tools,
        LiveAgentOptions {
            on_tool_call: Some(Arc::new(|_| {
                Box::pin(async { Err(Error::Tool("call storage failed".into())) })
            })),
            ..Default::default()
        },
    )
    .unwrap();
    input.send(call("unwritten")).await.unwrap();
    next(&mut agent).await;
    assert!(
        agent
            .next_events()
            .await
            .unwrap_err()
            .to_string()
            .contains("call storage failed")
    );
    assert_eq!(count.load(Ordering::SeqCst), 0);
    assert!(
        !sent
            .lock()
            .unwrap()
            .iter()
            .any(|v| v.get("toolResponse").is_some())
    );
    assert!(agent.close().await.is_err());
}

#[tokio::test]
async fn persisted_status_distinguishes_handler_failure_cancellation_and_error_shaped_data() {
    let tools = vec![Tool::new(
        "work",
        "Work",
        json!({"type":"object"}),
        |_, context| async move {
            match context.call_id.as_str() {
                "failed" => Err(Error::Tool("write refused".into())),
                "cancelled" => Err(Error::Cancelled),
                _ => Ok(json!({"error":"a field in successful data"})),
            }
        },
    )];
    let (session, input, _) = connect(config(&tools)).await;
    let stored = Arc::new(Mutex::new(vec![]));
    let options = LiveAgentOptions {
        on_tool_result: Some(Arc::new({
            let stored = stored.clone();
            move |outcome| {
                let stored = stored.clone();
                Box::pin(async move {
                    stored.lock().unwrap().push(outcome);
                    Ok(())
                })
            }
        })),
        ..Default::default()
    };
    let mut agent = LiveAgent::new(session, tools, options).unwrap();
    for (id, status) in [
        ("failed", LiveToolStatus::Error),
        ("cancelled", LiveToolStatus::Cancelled),
        ("data", LiveToolStatus::Success),
    ] {
        input.send(call(id)).await.unwrap();
        loop {
            let events = next(&mut agent).await;
            if let Some(actual) = events.iter().find_map(|event| match event {
                LiveAgentEvent::ToolResult { status, .. } => Some(*status),
                _ => None,
            }) {
                assert_eq!(actual, status);
                break;
            }
        }
        let stored = stored.lock().unwrap();
        let outcome = stored.last().unwrap();
        assert_eq!(outcome.generation, 0);
        assert_eq!(outcome.result.call_id, id);
        assert_eq!(outcome.status, status);
    }
    agent.close().await.unwrap();
}
