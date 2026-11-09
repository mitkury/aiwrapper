//! Opt-in live voice smoke test. Uses provider credentials and billable inference.
use aiwrapper::{live::*, *};
use serde_json::json;
use std::time::Duration;

#[tokio::test]
#[ignore = "requires live voice credentials and makes billable requests"]
async fn live_voice_produces_audio_and_completes() {
    for (provider, key, model_key, default_model) in [
        (
            LiveProvider::Openai,
            "OPENAI_API_KEY",
            "OPENAI_SPEECH_TO_SPEECH_MODEL",
            "gpt-realtime-2.1",
        ),
        (
            LiveProvider::Google,
            "GOOGLE_API_KEY",
            "GEMINI_LIVE_MODEL",
            "gemini-3.8-live",
        ),
    ] {
        let api_key = std::env::var(key).expect("live key required");
        let model = std::env::var(model_key)
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or(default_model.into());
        let mut config = LiveConfig::new(provider, model, api_key);
        config.instructions = "Say hello briefly.".into();
        let mut session = config.connect().await.unwrap();
        for prompt in ["Say hello.", "Say goodbye."] {
            session
                .sender
                .send_text(prompt, Role::User, true)
                .await
                .unwrap();
            let mut audio = false;
            let mut ended = false;
            tokio::time::timeout(Duration::from_secs(30), async {
                while let Some(event) = session.receiver.next_event().await.unwrap() {
                    if let LiveEvent::Audio { ref frame, .. } = event {
                        audio |= !frame.samples.is_empty();
                    }
                    if matches!(event, LiveEvent::ResponseEnded) {
                        ended = true;
                        break;
                    }
                }
            })
            .await
            .unwrap();
            assert!(
                audio && ended,
                "live provider did not complete an audio response"
            );
        }
        session.sender.close().await.unwrap();
    }
}

#[tokio::test]
#[ignore = "requires live voice credentials and makes billable requests"]
async fn openai_live_tools_interrupt_and_next_turn() {
    let model = std::env::var("OPENAI_SPEECH_TO_SPEECH_MODEL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or("gpt-realtime-2.1".into());
    let mut config = LiveConfig::new(
        LiveProvider::Openai,
        model,
        std::env::var("OPENAI_API_KEY").expect("live key required"),
    );
    config.instructions = "Keep answers very brief. Use add when asked to add numbers. After its result, say the answer without calling it again.".into();
    config.tools = vec![ToolDefinition {
        name: "add".into(),
        description: "Add two integers.".into(),
        parameters: json!({"type":"object","properties":{"a":{"type":"integer"},"b":{"type":"integer"}},"required":["a","b"],"additionalProperties":false}),
    }];
    let mut session = config.connect().await.unwrap();
    session
        .sender
        .send_text(
            "Use add to add 2 and 3, then say the result.",
            Role::User,
            true,
        )
        .await
        .unwrap();
    let mut calls = 0;
    let mut audio = false;
    let completed = tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = session.receiver.next_event().await.unwrap() {
            match event {
                LiveEvent::ToolCall {
                    call_id,
                    name,
                    arguments,
                } => {
                    calls += 1;
                    assert!(calls <= 2, "unexpected repeated tool calls");
                    assert_eq!(name, "add");
                    let sum = arguments["a"].as_i64().unwrap() + arguments["b"].as_i64().unwrap();
                    session
                        .sender
                        .send_tool_results(&[LiveToolResult {
                            call_id,
                            name,
                            result: json!({"sum":sum}),
                            images: vec![],
                        }])
                        .await
                        .unwrap();
                    audio = false;
                }
                LiveEvent::Audio { .. } if calls > 0 => audio = true,
                LiveEvent::ResponseEnded if calls > 0 && audio => return true,
                _ => {}
            }
        }
        false
    })
    .await
    .unwrap();
    assert!(completed && calls > 0);

    session
        .sender
        .send_text("Count slowly from one to twenty.", Role::User, true)
        .await
        .unwrap();
    let interrupted = tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = session.receiver.next_event().await.unwrap() {
            if matches!(event, LiveEvent::Audio { .. }) {
                session.sender.interrupt().await.unwrap();
                return true;
            }
        }
        false
    })
    .await
    .unwrap();
    assert!(interrupted);
    let ended = tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = session.receiver.next_event().await.unwrap() {
            assert!(
                !matches!(event, LiveEvent::Audio { .. }),
                "audio leaked after interruption"
            );
            if matches!(event, LiveEvent::ResponseEnded) {
                return true;
            }
        }
        false
    })
    .await
    .unwrap();
    assert!(ended);
    session
        .sender
        .send_text("Say goodbye.", Role::User, true)
        .await
        .unwrap();
    let mut audio = false;
    let ended = tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = session.receiver.next_event().await.unwrap() {
            audio |= matches!(event, LiveEvent::Audio { .. });
            if matches!(event, LiveEvent::ResponseEnded) {
                return true;
            }
        }
        false
    })
    .await
    .unwrap();
    assert!(audio && ended);
    session.sender.close().await.unwrap();
}
