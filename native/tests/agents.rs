mod common;
use aiwrapper::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn add_tool(counter: Arc<AtomicUsize>) -> Tool {
    Tool::new(
        "add",
        "Add",
        json!({"type":"object","properties":{"a":{"type":"integer"},"b":{"type":"integer"}},"required":["a","b"]}),
        move |args, _| {
            counter.fetch_add(1, Ordering::SeqCst);
            async move {
                Ok(json!(
                    args["a"].as_i64().unwrap() + args["b"].as_i64().unwrap()
                ))
            }
        },
    )
}

#[tokio::test]
async fn refreshed_handlers_and_persisted_messages_precede_the_next_round() {
    let order = Arc::new(std::sync::Mutex::new(Vec::new()));
    let count = Arc::new(AtomicUsize::new(0));
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([
        common::tool(),
        Message::assistant("5"),
    ])));
    agent.refresh_tools = Some(Arc::new({
        let order = order.clone();
        move || {
            order.lock().unwrap().push("refresh");
            let count = count.clone();
            Box::pin(async move { Ok(vec![add_tool(count)]) })
        }
    }));
    agent.on_message = Some(Arc::new({
        let order = order.clone();
        move |message, _| {
            let order = order.clone();
            Box::pin(async move {
                order
                    .lock()
                    .unwrap()
                    .push(if message.role == Role::ToolResults {
                        "result"
                    } else {
                        "response"
                    });
                Ok(())
            })
        }
    }));
    agent
        .run(
            vec![Message::user("add")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    assert_eq!(
        *order.lock().unwrap(),
        ["refresh", "response", "result", "refresh", "response"]
    );
}

#[tokio::test]
async fn persistence_failure_prevents_side_effects_and_retains_provider_response() {
    let count = Arc::new(AtomicUsize::new(0));
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([common::tool()])));
    agent.tools = vec![add_tool(count.clone())];
    agent.on_message = Some(Arc::new(|_, _| {
        Box::pin(async { Err(Error::Protocol("storage unavailable".into())) })
    }));
    let error = agent
        .run(
            vec![Message::user("add")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("storage unavailable"));
    assert_eq!(count.load(Ordering::SeqCst), 0);
    assert!(agent.conversation.messages.last().unwrap().has_tools());
}
#[tokio::test]
async fn agent_executes_tools_once_and_persists_serializable_history() {
    let count = Arc::new(AtomicUsize::new(0));
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([
        common::tool(),
        Message::assistant("5"),
    ])));
    agent.tools = vec![add_tool(count.clone())];
    let mut events = vec![];
    agent
        .run(
            vec![Message::user("Add 2 and 3")],
            &ChatOptions::default(),
            &mut |e| events.push(e),
        )
        .await
        .unwrap();
    assert_eq!(agent.conversation.answer(), "5");
    assert_eq!(count.load(Ordering::SeqCst), 1);
    agent.conversation.validate().unwrap();
    let roundtrip: Conversation =
        serde_json::from_str(&serde_json::to_string(&agent.conversation).unwrap()).unwrap();
    assert_eq!(roundtrip, agent.conversation);
    assert!(matches!(
        events.last(),
        Some(AgentEvent::State { running: false })
    ));
}
#[tokio::test]
async fn invalid_arguments_and_unknown_tools_become_results_without_running_handler() {
    let count = Arc::new(AtomicUsize::new(0));
    let mut call = common::tool();
    if let Item::Tool { arguments, .. } = &mut call.items[0] {
        *arguments = json!({"a":"bad"});
    }
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([
        call,
        Message::assistant("Failed"),
    ])));
    agent.tools = vec![add_tool(count.clone())];
    agent
        .run(
            vec![Message::user("Hi")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 0);
    assert!(
        serde_json::to_string(&agent.conversation)
            .unwrap()
            .contains("schema validation")
    );
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([
        common::tool(),
        Message::assistant("No such tool"),
    ])));
    agent
        .run(
            vec![Message::user("Hi")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    assert!(
        serde_json::to_string(&agent.conversation)
            .unwrap()
            .contains("unknown or disabled tool")
    );
}
#[tokio::test]
async fn iteration_limit_preserves_completed_tools() {
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([common::tool()])));
    agent.max_iterations = 1;
    agent.tools = vec![add_tool(Arc::new(AtomicUsize::new(0)))];
    assert!(matches!(
        agent
            .run(
                vec![Message::user("Hi")],
                &ChatOptions::default(),
                &mut |_| {}
            )
            .await,
        Err(Error::IterationLimit(1))
    ));
    agent.conversation.validate().unwrap();
    assert!(!agent.conversation.finished);
}
#[tokio::test]
async fn cancellation_retains_completed_side_effects_and_does_not_execute_later_calls() {
    let count = Arc::new(AtomicUsize::new(0));
    let mut call = common::tool();
    call.items.push(Item::Tool {
        call_id: "second".into(),
        name: "later".into(),
        arguments: json!({}),
        thought_signature: None,
    });
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([call])));
    agent.tools = vec![
        Tool::new("add", "Add", json!({}), |_, ctx| async move {
            ctx.cancellation.cancel();
            Ok(json!(5))
        }),
        Tool::new("later", "Later", json!({}), {
            let count = count.clone();
            move |_, _| {
                count.fetch_add(1, Ordering::SeqCst);
                async { Ok(json!(true)) }
            }
        }),
    ];
    assert!(matches!(
        agent
            .run(
                vec![Message::user("Hi")],
                &ChatOptions::default(),
                &mut |_| {}
            )
            .await,
        Err(Error::Cancelled)
    ));
    assert_eq!(count.load(Ordering::SeqCst), 0);
    assert!(agent.conversation.aborted);
    assert!(
        matches!(&agent.conversation.messages.last().unwrap().items[0],Item::ToolResult {result,..} if result==&json!(5))
    );
    // Resuming requires an explicit cancelled result for the unexecuted call.
    assert!(agent.conversation.validate().is_err());
}
fn history() -> Conversation {
    let mut history = Conversation {
        instructions: "Keep this instruction".into(),
        ..Conversation::default()
    };
    for _ in 0..12 {
        history.messages.push(Message::user("old ".repeat(80)));
        history
            .messages
            .push(Message::assistant("answer ".repeat(40)));
    }
    history.messages.push(Message::user("Latest request"));
    history
}
#[tokio::test]
async fn compression_preserves_transcript_latest_input_and_validates_checkpoint() {
    let original = history();
    let mut compression = Compression::new(1024).unwrap();
    let mock = MockLang::new(
        (0..30).map(|_| Message::assistant("Saved decisions and completed actions.")),
    );
    let projected = compression
        .prepare(&mock, &original, &ChatOptions::default())
        .await
        .unwrap();
    assert_eq!(original, history());
    assert_eq!(projected.instructions, original.instructions);
    assert_eq!(
        projected.messages.last().unwrap().answer(),
        "Latest request"
    );
    assert!(estimate_tokens(&projected, &[]) < 1024);
    assert!(
        compression.checkpoint.as_ref().unwrap().tokens_before
            > compression.checkpoint.as_ref().unwrap().tokens_after
    );
    // A persisted checkpoint can be restored without making another summary call.
    compression.checkpoint = Some(
        serde_json::from_str(
            &serde_json::to_string(compression.checkpoint.as_ref().unwrap()).unwrap(),
        )
        .unwrap(),
    );
    assert_eq!(
        compression
            .prepare(&MockLang::new([]), &original, &ChatOptions::default())
            .await
            .unwrap(),
        projected
    );
    let mut changed = original.clone();
    changed.messages[0] = Message::user("edited");
    assert!(
        compression
            .prepare(&mock, &changed, &ChatOptions::default())
            .await
            .is_err()
    );
}
#[tokio::test]
async fn failed_checkpoint_persistence_does_not_advance_state() {
    let mut compression = Compression::new(1024).unwrap();
    compression.on_checkpoint = Some(Arc::new(|_| {
        Box::pin(async { Err(Error::Compression("disk unavailable".into())) })
    }));
    let mock = MockLang::new((0..30).map(|_| Message::assistant("Summary.")));
    assert!(
        compression
            .prepare(&mock, &history(), &ChatOptions::default())
            .await
            .is_err()
    );
    assert!(compression.checkpoint.is_none());
}
#[tokio::test]
async fn oversized_summaries_fail_without_replacing_context() {
    let mut compression = Compression::new(1024).unwrap();
    let original = history();
    let mock = MockLang::new([Message::assistant("x".repeat(1000))]);
    assert!(
        compression
            .prepare(&mock, &original, &ChatOptions::default())
            .await
            .is_err()
    );
    assert!(compression.checkpoint.is_none());
    assert_eq!(original, history());
}

#[tokio::test]
async fn repeated_call_ids_never_repeat_a_side_effect() {
    let count = Arc::new(AtomicUsize::new(0));
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([common::tool(), common::tool()])));
    agent.tools = vec![add_tool(count.clone())];
    assert!(matches!(
        agent
            .run(
                vec![Message::user("Hi")],
                &ChatOptions::default(),
                &mut |_| {}
            )
            .await,
        Err(Error::Protocol(_))
    ));
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn explicitly_empty_tools_disable_registered_handlers_for_one_turn() {
    let transport = common::Fixture::new(vec![(200, common::chat("No tools"))]);
    let count = Arc::new(AtomicUsize::new(0));
    let mut agent = ChatAgent::new(Arc::new(transport.lang(Provider::OpenaiCompatible)));
    agent.tools = vec![add_tool(count.clone())];
    let options = ChatOptions {
        tools: Some(vec![]),
        ..ChatOptions::default()
    };
    agent
        .run(vec![Message::user("Hi")], &options, &mut |_| {})
        .await
        .unwrap();
    assert!(
        transport.requests.lock().unwrap()[0]
            .1
            .get("tools")
            .is_none()
    );
    assert_eq!(count.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn compression_never_splits_tool_pairs_and_keeps_latest_request_in_long_loop() {
    let mut history = history();
    let latest = history.messages.last().unwrap().clone();
    for index in 0..12 {
        history.messages.push(Message::new(
            Role::Assistant,
            vec![Item::Tool {
                call_id: format!("c{index}"),
                name: "read".into(),
                arguments: json!({}),
                thought_signature: None,
            }],
        ));
        history.messages.push(Message::new(
            Role::ToolResults,
            vec![Item::ToolResult {
                call_id: format!("c{index}"),
                name: "read".into(),
                result: json!("large result ".repeat(60)),
            }],
        ));
    }
    let mut compression = Compression::new(2048).unwrap();
    let mock = MockLang::new(
        (0..60).map(|_| Message::assistant("Completed tool calls and remaining work.")),
    );
    let projected = compression
        .prepare(&mock, &history, &ChatOptions::default())
        .await
        .unwrap();
    projected.validate().unwrap();
    assert!(projected.messages.contains(&latest));
    assert_eq!(history.messages.len(), 49);
}
#[tokio::test]
async fn oversized_latest_input_fails_before_requesting_a_summary() {
    let mut compression = Compression::new(1024).unwrap();
    let mut history = history();
    history.messages.push(Message::user("x".repeat(4000)));
    let error = compression
        .prepare(&MockLang::new([]), &history, &ChatOptions::default())
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Compression(_)));
    assert!(compression.checkpoint.is_none());
}

#[tokio::test]
async fn cancellation_on_final_output_is_not_reported_as_success() {
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([Message::assistant("partial")])));
    let options = ChatOptions::default();
    let mut events = vec![];
    let result = agent
        .run(vec![Message::user("Hi")], &options, &mut |event| {
            if matches!(event, AgentEvent::Streaming { .. }) {
                options.cancellation.cancel();
            }
            events.push(event);
        })
        .await;
    assert!(matches!(result, Err(Error::Cancelled)));
    assert_eq!(agent.conversation.answer(), "partial");
    assert!(agent.conversation.aborted);
    assert!(!agent.conversation.finished);
    assert!(events.iter().any(|e| matches!(e, AgentEvent::Aborted)));
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::Finished)));
}

#[tokio::test]
async fn final_snapshot_is_emitted_only_when_it_changes() {
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([Message::assistant("Done")])));
    let mut snapshots = vec![];
    agent
        .run(
            vec![Message::user("Hi")],
            &ChatOptions::default(),
            &mut |event| {
                if let AgentEvent::Streaming { message, .. } = event {
                    snapshots.push(message);
                }
            },
        )
        .await
        .unwrap();
    assert_eq!(snapshots, vec![Message::assistant("Done")]);
}

#[tokio::test]
async fn cancellation_during_last_tool_preserves_result_and_beats_iteration_limit() {
    let mut agent = ChatAgent::new(Arc::new(MockLang::new([common::tool()])));
    agent.max_iterations = 1;
    agent.tools = vec![Tool::new("add", "Add", json!({}), |_, ctx| async move {
        ctx.cancellation.cancel();
        Ok(json!(5))
    })];
    assert!(matches!(
        agent
            .run(
                vec![Message::user("Hi")],
                &ChatOptions::default(),
                &mut |_| {}
            )
            .await,
        Err(Error::Cancelled)
    ));
    agent.conversation.validate().unwrap();
    assert!(
        matches!(&agent.conversation.messages.last().unwrap().items[0], Item::ToolResult { result, .. } if result == &json!(5))
    );
}

#[tokio::test]
async fn restored_checkpoint_cannot_split_a_tool_group_or_erase_history_with_empty_summary() {
    use sha2::{Digest, Sha256};
    let mut original = Conversation::new("Add");
    original.messages.push(common::tool());
    original.messages.push(Message::new(
        Role::ToolResults,
        vec![Item::ToolResult {
            call_id: "call1".into(),
            name: "add".into(),
            result: json!(5),
        }],
    ));
    original.validate().unwrap();
    for (cut, summary) in [(2, "Added numbers"), (3, "  "), (0, "No history")] {
        let mut compression = Compression::new(1024).unwrap();
        compression.checkpoint = Some(CompressionCheckpoint {
            summary: summary.into(),
            through_message_count: cut,
            prefix_sha256: format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&original.messages[..cut]).unwrap())
            ),
            tokens_before: 0,
            tokens_after: 0,
        });
        assert!(matches!(
            compression
                .prepare(&MockLang::new([]), &original, &ChatOptions::default())
                .await,
            Err(Error::Compression(_))
        ));
    }
}

#[tokio::test]
async fn compression_keeps_request_headers_and_retry_policy_but_disables_tools() {
    use async_trait::async_trait;
    struct SummaryProvider;
    #[async_trait]
    impl LanguageProvider for SummaryProvider {
        async fn complete(
            &self,
            context: &Conversation,
            options: &ChatOptions,
            _: &mut (dyn for<'m> FnMut(&'m Message) + Send),
        ) -> Result<Message> {
            context.validate()?;
            assert_eq!(
                options.headers.get("x-tenant").map(String::as_str),
                Some("test")
            );
            assert_eq!(options.max_retries, 0);
            assert_eq!(options.tools.as_ref().map(Vec::len), Some(0));
            assert!(options.schema.is_none());
            assert!(options.built_in_tools.is_empty());
            Ok(Message::assistant("Summary"))
        }
    }
    let options = ChatOptions {
        headers: std::collections::BTreeMap::from([("x-tenant".into(), "test".into())]),
        max_retries: 0,
        schema: Some(json!({"type":"object"})),
        ..ChatOptions::default()
    };
    Compression::new(1024)
        .unwrap()
        .prepare(&SummaryProvider, &history(), &options)
        .await
        .unwrap();
}
