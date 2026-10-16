//! Opt-in live voice smoke test. Uses provider credentials and billable inference.
use aiwrapper::{live::*, *};
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
        session
            .sender
            .send_text("Say hello.", Role::User, true)
            .await
            .unwrap();
        let mut audio = false;
        tokio::time::timeout(Duration::from_secs(30), async {
            while let Some(event) = session.receiver.next_event().await.unwrap() {
                if let LiveEvent::Audio { ref frame, .. } = event {
                    audio |= !frame.samples.is_empty();
                }
                if matches!(event, LiveEvent::ResponseEnded) {
                    break;
                }
            }
        })
        .await
        .unwrap();
        assert!(audio, "live provider returned no audio");
        session.sender.close().await.unwrap();
    }
}
