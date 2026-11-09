use aiwrapper::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

fn echo(calls: Arc<Mutex<Vec<String>>>) -> Tool {
    Tool::new(
        "echo",
        "Echo text",
        json!({
            "type":"object", "properties":{"text":{"type":"string"}}, "required":["text"]
        }),
        move |args, _| {
            let text = args["text"].as_str().unwrap().to_owned();
            calls.lock().unwrap().push(text.clone());
            async move { Ok(json!({"echoed": text})) }
        },
    )
}

#[tokio::test]
async fn interactive_tool_commands_use_actual_results_once_and_survive_restart() {
    let calls = Arc::new(Mutex::new(vec![]));
    let mut agent = ChatAgent::new(Arc::new(MockLang::interactive()));
    agent.tools.push(echo(calls.clone()));
    let command = Message::user("tool: echo {\"text\":\"tool: echo {}\"}");
    let mut events = vec![];
    agent
        .run(vec![command.clone()], &ChatOptions::default(), &mut |e| {
            events.push(e)
        })
        .await
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec!["tool: echo {}"]);
    assert!(agent.conversation.answer().contains("Tool result: echo"));
    assert!(agent.conversation.answer().contains("tool: echo {}"));
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::Streaming {message, ..} if message.has_tools()))
    );
    let saved = serde_json::to_string(&agent.conversation).unwrap();
    let mut restarted = ChatAgent::new(Arc::new(MockLang::interactive()));
    restarted.conversation = serde_json::from_str(&saved).unwrap();
    restarted.tools.push(echo(calls.clone()));
    restarted
        .run(vec![command], &ChatOptions::default(), &mut |_| {})
        .await
        .unwrap();
    assert_eq!(calls.lock().unwrap().len(), 2);
    restarted.conversation.validate().unwrap();
}

#[tokio::test]
async fn malformed_disabled_and_failing_tools_do_not_get_stuck() {
    let calls = Arc::new(Mutex::new(vec![]));
    let mut agent = ChatAgent::new(Arc::new(MockLang::interactive()));
    agent.tools.push(echo(calls.clone()));
    for prompt in [
        "tool:",
        "tool: echo",
        "tool: echo {bad}",
        "tool: echo []",
        "tool: echo null",
    ] {
        agent
            .run(
                vec![Message::user(prompt)],
                &ChatOptions::default(),
                &mut |_| {},
            )
            .await
            .unwrap();
        assert!(
            agent
                .conversation
                .answer()
                .starts_with("Invalid mock tool command")
        );
    }
    let disabled = ChatOptions {
        tools: Some(vec![]),
        ..ChatOptions::default()
    };
    agent
        .run(vec![Message::user("tool: echo {}")], &disabled, &mut |_| {})
        .await
        .unwrap();
    assert!(agent.conversation.answer().contains("unavailable"));
    agent
        .run(
            vec![Message::user("tool: echo {\"text\":3}")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    assert!(agent.conversation.answer().contains("schema validation"));
    agent
        .tools
        .push(Tool::new("fail", "Fail", json!({}), |_, _| async {
            Err(Error::Tool("fixture failed".into()))
        }));
    agent
        .run(
            vec![Message::user("tool: fail {}")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    assert!(agent.conversation.answer().contains("fixture failed"));
    assert!(calls.lock().unwrap().is_empty());
    agent.conversation.validate().unwrap();
}

#[tokio::test]
async fn streaming_is_unicode_safe_cancellable_and_preserves_partial_output() {
    let mut agent = ChatAgent::new(Arc::new(MockLang::interactive()));
    let prompt = "語🦀".repeat(80);
    let expected = format!("Mock reply: {prompt}");
    let options = ChatOptions::default();
    let mut snapshots = vec![];
    let result = agent
        .run(vec![Message::user(prompt)], &options, &mut |event| {
            if let AgentEvent::Streaming { message, .. } = event {
                snapshots.push(message.answer());
                if snapshots.len() == 2 {
                    options.cancellation.cancel();
                }
            }
        })
        .await;
    assert!(matches!(result, Err(Error::Cancelled)));
    assert_eq!(snapshots.len(), 2);
    assert!(
        snapshots
            .windows(2)
            .all(|pair| pair[1].starts_with(&pair[0]) && pair[1].len() > pair[0].len())
    );
    assert!(expected.starts_with(&agent.conversation.answer()));
    assert_ne!(agent.conversation.answer(), expected);
    assert!(agent.conversation.aborted);
}

#[tokio::test]
async fn one_interactive_provider_serves_independent_conversations_concurrently() {
    let provider = Arc::new(MockLang::interactive());
    let run = |text: &'static str| {
        let provider = provider.clone();
        async move {
            let mut agent = ChatAgent::new(provider);
            agent
                .run(
                    vec![Message::user(text)],
                    &ChatOptions::default(),
                    &mut |_| {},
                )
                .await
                .unwrap();
            agent.conversation.answer()
        }
    };
    let (first, second) = tokio::join!(run("first"), run("second"));
    assert_eq!(first, "Mock reply: first");
    assert_eq!(second, "Mock reply: second");
}

#[tokio::test]
async fn callback_mock_checks_structured_output_and_does_not_run_when_pre_cancelled() {
    let options = ChatOptions {
        schema: Some(
            json!({"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}),
        ),
        ..ChatOptions::default()
    };
    for (reply, valid) in [("{\"ok\":true}", true), ("{\"ok\":3}", false)] {
        let provider = MockLang::from_fn(move |context, _| {
            assert_eq!(context.messages[0].answer(), "Check");
            Ok(Message::assistant(reply))
        });
        let result = provider
            .complete(&Conversation::new("Check"), &options, &mut |_| {})
            .await;
        assert_eq!(result.is_ok(), valid);
    }
    options.cancellation.cancel();
    let provider = MockLang::from_fn(|_, _| panic!("cancelled request reached responder"));
    assert!(matches!(
        provider
            .complete(&Conversation::new("Check"), &options, &mut |_| {})
            .await,
        Err(Error::Cancelled)
    ));
    let invalid_schema = ChatOptions {
        schema: Some(json!({"type":"invalid-type"})),
        ..ChatOptions::default()
    };
    let provider = MockLang::from_fn(|_, _| panic!("invalid schema reached responder"));
    assert!(matches!(
        provider
            .complete(&Conversation::new("Check"), &invalid_schema, &mut |_| {})
            .await,
        Err(Error::Schema(_))
    ));
}
