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
        json!({"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}),
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
