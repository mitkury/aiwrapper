use aiwrapper::*;
use serde_json::json;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

const BUDGET: usize = 1024;
const INSTRUCTIONS: &str = "Only read; never modify anything.";

#[derive(Default)]
struct Trace {
    summaries: Vec<Conversation>,
    turns: Vec<Conversation>,
    checkpoints: Vec<CompressionCheckpoint>,
    executed: Vec<usize>,
}

// A deliberately narrow simulated task: finish N numbered reads. Progress is
// learned from actual tool results or the summary, never from a reply queue or
// the fixture's execution log. The summary only extracts our known marker;
// this exercises compression mechanics, not language-model summary quality.
fn completed_step(text: &str) -> usize {
    text.split("completed_step=")
        .skip(1)
        .filter_map(|part| {
            part.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse::<usize>()
                .ok()
        })
        .max()
        .unwrap_or(0)
}

fn provider(trace: Arc<Mutex<Trace>>) -> Arc<MockLang> {
    Arc::new(MockLang::from_fn(move |context, options| {
        context.validate()?;
        assert!(
            estimate_tokens(context, options.tool_definitions()) < BUDGET,
            "model input exceeded its budget"
        );
        let text = context
            .messages
            .iter()
            .map(Message::answer)
            .collect::<Vec<_>>()
            .join("\n");
        if context.instructions.starts_with("Summarize historical") {
            assert_eq!(options.tools.as_ref().map(Vec::len), Some(0));
            assert!(options.built_in_tools.is_empty());
            assert!(options.schema.is_none());
            assert!(options.max_tokens.is_some());
            trace.lock().unwrap().summaries.push(context.clone());
            return Ok(Message::assistant(format!(
                "completed_step={}",
                completed_step(&text)
            )));
        }
        assert_eq!(context.instructions, INSTRUCTIONS);
        let latest = context
            .messages
            .iter()
            .rfind(|m| m.role == Role::User)
            .unwrap()
            .answer();
        let goal: usize = latest.strip_prefix("run:").unwrap().trim().parse().unwrap();
        let mut completed = completed_step(&text);
        for item in context.messages.iter().flat_map(|m| &m.items) {
            if let Item::ToolResult { result, .. } = item {
                completed = completed.max(result["completed_step"].as_u64().unwrap() as usize);
            }
        }
        let mut trace = trace.lock().unwrap();
        if context
            .messages
            .first()
            .unwrap()
            .answer()
            .starts_with("Earlier conversation summary")
        {
            let saved = trace
                .checkpoints
                .last()
                .expect("projection used before checkpoint persisted");
            assert!(context.messages[0].answer().contains(&saved.summary));
        }
        trace.turns.push(context.clone());
        if completed >= goal {
            return Ok(Message::assistant(format!("Completed {completed} reads.")));
        }
        let next = completed + 1;
        Ok(Message::new(
            Role::Assistant,
            vec![Item::Tool {
                call_id: format!("read-{next}"),
                name: "read".into(),
                arguments: json!({"step": next}),
                thought_signature: None,
            }],
        ))
    }))
}

fn agent(trace: Arc<Mutex<Trace>>, padding: &str) -> ChatAgent {
    let mut agent = ChatAgent::new(provider(trace.clone()));
    agent.conversation.instructions = INSTRUCTIONS.into();
    agent.max_iterations = 16;
    let padding = padding.to_owned();
    agent.tools.push(Tool::new("read", "Read a numbered record", json!({"type":"object","properties":{"step":{"type":"integer","minimum":1}},"required":["step"]}), {
        let trace = trace.clone();
        move |args, _| {
            let step = args["step"].as_u64().unwrap() as usize;
            trace.lock().unwrap().executed.push(step);
            let text = format!("{padding} completed_step={step} ").repeat(150);
            async move { Ok(json!({"completed_step":step, "text":text})) }
        }
    }));
    let mut compression = Compression::new(BUDGET).unwrap();
    compression.on_checkpoint = Some(Arc::new(move |checkpoint| {
        trace.lock().unwrap().checkpoints.push(checkpoint);
        Box::pin(async { Ok(()) })
    }));
    agent.compression = Some(compression);
    agent
}

#[tokio::test]
async fn repeated_compression_and_restart_continue_the_real_tool_loop_without_reexecution() {
    let escaped = "\\".repeat(128);
    for padding in [
        "large record",
        "日本語 🦀",
        "quotes: \" \\ \n \t",
        escaped.as_str(),
    ] {
        let trace = Arc::new(Mutex::new(Trace::default()));
        let mut original = agent(trace.clone(), padding);
        original
            .run(
                vec![Message::user("run: 6")],
                &ChatOptions::default(),
                &mut |_| {},
            )
            .await
            .unwrap();
        assert_eq!(original.conversation.answer(), "Completed 6 reads.");
        assert_eq!(original.conversation.messages.len(), 14);
        original.conversation.validate().unwrap();
        for item in original.conversation.messages.iter().flat_map(|m| &m.items) {
            if let Item::ToolResult { result, .. } = item {
                let step = result["completed_step"].as_u64().unwrap();
                assert_eq!(
                    result["text"],
                    format!("{padding} completed_step={step} ").repeat(150)
                );
            }
        }
        {
            let trace = trace.lock().unwrap();
            assert_eq!(trace.executed, (1..=6).collect::<Vec<_>>());
            assert_eq!(trace.checkpoints.len(), 6);
            assert!(
                trace.summaries.len() > trace.checkpoints.len(),
                "large results should require multiple summary chunks"
            );
            assert!(
                trace
                    .checkpoints
                    .windows(2)
                    .all(|pair| pair[1].through_message_count > pair[0].through_message_count)
            );
            assert!(
                trace
                    .checkpoints
                    .iter()
                    .all(|c| c.tokens_after < c.tokens_before && c.tokens_after < BUDGET)
            );
        }
        let saved_history = serde_json::to_string(&original.conversation).unwrap();
        let saved_checkpoint =
            serde_json::to_string(&original.compression.as_ref().unwrap().checkpoint).unwrap();
        let summaries_before = trace.lock().unwrap().summaries.len();
        let mut restored = agent(trace.clone(), padding);
        restored.conversation = serde_json::from_str(&saved_history).unwrap();
        restored.compression.as_mut().unwrap().checkpoint =
            serde_json::from_str(&saved_checkpoint).unwrap();
        restored
            .run(
                vec![Message::user("run: 6")],
                &ChatOptions::default(),
                &mut |_| {},
            )
            .await
            .unwrap();
        assert_eq!(trace.lock().unwrap().summaries.len(), summaries_before);
        assert_eq!(trace.lock().unwrap().executed.len(), 6);
        restored
            .run(
                vec![Message::user("run: 8")],
                &ChatOptions::default(),
                &mut |_| {},
            )
            .await
            .unwrap();
        assert_eq!(restored.conversation.answer(), "Completed 8 reads.");
        assert_eq!(trace.lock().unwrap().executed, (1..=8).collect::<Vec<_>>());
        assert_eq!(
            original.conversation.messages,
            restored.conversation.messages[..original.conversation.messages.len()]
        );
    }
}

#[tokio::test]
async fn a_small_conversation_needs_no_summary_or_checkpoint() {
    let trace = Arc::new(Mutex::new(Trace::default()));
    let mut agent = agent(trace.clone(), "");
    agent
        .run(
            vec![Message::user("run: 0")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    let trace = trace.lock().unwrap();
    assert!(trace.summaries.is_empty());
    assert!(trace.checkpoints.is_empty());
    assert_eq!(trace.turns.len(), 1);
}

#[tokio::test]
async fn failed_checkpoint_write_can_retry_without_repeating_a_completed_tool() {
    let trace = Arc::new(Mutex::new(Trace::default()));
    let mut agent = agent(trace.clone(), "large record");
    agent
        .run(
            vec![Message::user("run: 1")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    let previous = agent.compression.as_ref().unwrap().checkpoint.clone();
    assert!(previous.is_some());
    let fail = Arc::new(AtomicBool::new(true));
    agent.compression.as_mut().unwrap().on_checkpoint = Some(Arc::new({
        let trace = trace.clone();
        let fail = fail.clone();
        move |checkpoint| {
            let rejected = fail.swap(false, Ordering::SeqCst);
            if !rejected {
                trace.lock().unwrap().checkpoints.push(checkpoint);
            }
            Box::pin(async move {
                if rejected {
                    Err(Error::Compression("disk unavailable".into()))
                } else {
                    Ok(())
                }
            })
        }
    }));
    assert!(matches!(
        agent
            .run(
                vec![Message::user("run: 2")],
                &ChatOptions::default(),
                &mut |_| {}
            )
            .await,
        Err(Error::Compression(_))
    ));
    assert_eq!(agent.conversation.messages.len(), 7);
    assert_eq!(agent.compression.as_ref().unwrap().checkpoint, previous);
    agent.conversation.validate().unwrap();
    agent
        .run(vec![], &ChatOptions::default(), &mut |_| {})
        .await
        .unwrap();
    assert_eq!(agent.conversation.answer(), "Completed 2 reads.");
    assert_eq!(trace.lock().unwrap().executed, vec![1, 2]);
}

#[tokio::test]
async fn failure_or_cancellation_mid_summary_keeps_durable_history_and_checkpoint_unchanged() {
    for cancel in [false, true] {
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = MockLang::from_fn({
            let calls = calls.clone();
            move |context, options| {
                assert!(context.instructions.starts_with("Summarize historical"));
                if calls.fetch_add(1, Ordering::SeqCst) == 1 {
                    if cancel {
                        options.cancellation.cancel();
                    } else {
                        return Err(Error::Protocol("summary failed halfway".into()));
                    }
                }
                Ok(Message::assistant(
                    "Internal summary must not become a task answer.",
                ))
            }
        });
        let mut history = Conversation::new("Goal");
        history
            .messages
            .push(Message::assistant("older history ".repeat(1500)));
        history.messages.push(Message::user("Latest request"));
        let original = history.clone();
        let mut agent = ChatAgent::new(Arc::new(provider));
        agent.conversation = history;
        let mut compression = Compression::new(BUDGET).unwrap();
        compression.on_checkpoint = Some(Arc::new(|_| panic!("unfinished summary was saved")));
        agent.compression = Some(compression);
        let mut events = vec![];
        let error = agent
            .run(vec![], &ChatOptions::default(), &mut |e| events.push(e))
            .await
            .unwrap_err();
        assert!(if cancel {
            matches!(error, Error::Cancelled)
        } else {
            matches!(error, Error::Protocol(_))
        });
        assert_eq!(agent.conversation.messages, original.messages);
        assert_eq!(agent.conversation.aborted, cancel);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(agent.compression.as_ref().unwrap().checkpoint.is_none());
        assert!(!events.iter().any(|e| matches!(
            e,
            AgentEvent::Streaming { .. } | AgentEvent::Compressed { .. }
        )));
    }
}
