mod common;
use aiwrapper::{speech::*, *};
use common::*;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

fn capture() -> (UsageHandler, Arc<Mutex<Vec<UsageEvent>>>) {
    let events = Arc::new(Mutex::new(vec![]));
    let output = events.clone();
    (
        Arc::new(move |event| output.lock().unwrap().push(event)),
        events,
    )
}
fn counts(provider: &str, raw: Value) -> Value {
    serde_json::to_value(normalize_usage(provider, &raw)).unwrap()
}
#[test]
fn provider_units_preserve_cache_modalities_reasoning_cost_and_unknowns() {
    assert_eq!(
        counts(
            "google",
            json!({"promptTokenCount":100,"candidatesTokenCount":10,"thoughtsTokenCount":5,"cachedContentTokenCount":20,"promptTokensDetails":[{"modality":"AUDIO","tokenCount":40},{"modality":"VIDEO","tokenCount":30}]})
        ),
        json!({"inputTokens":100.0,"outputTokens":15.0,"reasoningTokens":5.0,"cachedTokens":20.0,"inputAudioTokens":40.0,"inputImageTokens":30.0})
    );
    assert_eq!(
        counts(
            "anthropic",
            json!({"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":30,"output_tokens":4})
        ),
        json!({"inputTokens":60.0,"cachedTokens":20.0,"cacheWriteTokens":30.0,"outputTokens":4.0})
    );
    assert_eq!(
        counts(
            "openrouter",
            json!({"prompt_tokens":7,"completion_tokens":2,"cost":0.001,"completion_tokens_details":{"reasoning_tokens":1}})
        ),
        json!({"inputTokens":7.0,"outputTokens":2.0,"reasoningTokens":1.0,"costUsd":0.001})
    );
    assert_eq!(
        counts("openai", json!({"type":"duration","seconds":1.5})),
        json!({"audioSeconds":1.5})
    );
    assert_eq!(
        counts("google", json!({"totalBilledTime":"2.5s"})),
        json!({"audioSeconds":2.5})
    );
    assert_eq!(
        counts(
            "cohere",
            json!({"billed_units":{"input_tokens":4,"output_tokens":2},"tokens":{"input_tokens":99}})
        ),
        json!({"inputTokens":4.0,"outputTokens":2.0})
    );
    assert_eq!(
        counts("openai", json!({"input_tokens":-3,"output_tokens":"4"})),
        json!({})
    );
}
#[tokio::test]
async fn cumulative_updates_emit_once_even_when_the_stream_fails() {
    let fixture = Fixture::new(vec![(
        200,
        sse(vec![
            json!({"type":"message_start","message":{"id":"msg-1","model":"actual-model","usage":{"input_tokens":10,"cache_read_input_tokens":5}}}),
            json!({"type":"message_delta","usage":{"output_tokens":2}}),
            json!({"type":"message_delta","usage":{"output_tokens":7}}),
            json!({"type":"error","error":{"message":"broken"}}),
        ]),
    )]);
    let (handler, events) = capture();
    let lang = Lang::with_transport(
        ProviderConfig::new(Provider::Anthropic, "configured").with_usage_handler(handler),
        fixture,
    )
    .unwrap();
    assert!(lang.ask("hi", &ChatOptions::default()).await.is_err());
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].model, "actual-model");
    assert_eq!(events[0].request_id.as_deref(), Some("msg-1"));
    assert_eq!(events[0].usage.counts["inputTokens"], 15.0);
    assert_eq!(events[0].usage.counts["outputTokens"], 7.0);
    assert_eq!(events[0].raw_usage["cache_read_input_tokens"], 5);
}
#[tokio::test]
async fn compatible_requests_opt_in_to_usage_and_preserve_reported_cost() {
    let fixture = Fixture::new(vec![(
        200,
        sse(vec![
            json!({"id":"gen-1","model":"billed-model","choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}),
            json!({"usage":{"prompt_tokens":2,"completion_tokens":1,"cost":0.003,"extra":"kept"},"choices":[]}),
        ]),
    )]);
    let (handler, events) = capture();
    let lang = Lang::with_transport(
        ProviderConfig::new(Provider::Openrouter, "model").with_usage_handler(handler),
        fixture.clone(),
    )
    .unwrap();
    lang.ask("hi", &ChatOptions::default()).await.unwrap();
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].provider, "openrouter");
    assert_eq!(events[0].usage.counts["costUsd"], 0.003);
    assert_eq!(events[0].raw_usage["extra"], "kept");
    assert_eq!(
        fixture.requests.lock().unwrap()[0].1["stream_options"]["include_usage"],
        true
    );
}
#[tokio::test]
async fn observers_are_isolated_and_missing_usage_is_not_invented() {
    let fixture = Fixture::new(vec![
        (200, chat("hi")),
        (
            200,
            sse(vec![
                json!({"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2}}),
            ]),
        ),
    ]);
    let (handler, events) = capture();
    let mut lang = Lang::with_transport(
        ProviderConfig::new(Provider::Groq, "model").with_usage_handler(handler),
        fixture,
    )
    .unwrap();
    lang.ask("hi", &ChatOptions::default()).await.unwrap();
    assert!(events.lock().unwrap().is_empty());
    lang.config.on_usage = Some(Arc::new(|_| panic!("observer failure")));
    lang.ask("hi", &ChatOptions::default()).await.unwrap();
}
#[tokio::test]
async fn transcription_reports_usage_even_when_the_transcript_is_invalid() {
    let fixture = Fixture::new(vec![(
        200,
        json!({"usageMetadata":{"promptTokenCount":5}}).to_string(),
    )]);
    let (handler, events) = capture();
    let speech =
        Speech::with_transport("key", "https://test/v1", fixture).with_usage_handler(handler);
    assert!(
        speech
            .transcribe_gemini(
                b"audio",
                "audio/webm",
                "transcribe",
                &CancellationToken::new()
            )
            .await
            .is_err()
    );
    assert_eq!(events.lock().unwrap().len(), 1);
    assert_eq!(events.lock().unwrap()[0].operation, "transcription");
}

#[tokio::test]
async fn dropping_an_inflight_call_flushes_already_observed_usage() {
    use async_trait::async_trait;
    use futures_util::StreamExt;
    struct Pending;
    #[async_trait]
    impl HttpTransport for Pending {
        async fn send(&self, _: HttpRequest) -> Result<HttpResponse> {
            Ok(HttpResponse {
                status: 200,
                headers: Default::default(),
                body: futures_util::stream::once(async {
                    Ok(sse(vec![json!({"usageMetadata":{"promptTokenCount":11}})]).into_bytes())
                })
                .chain(futures_util::stream::pending())
                .boxed(),
            })
        }
    }
    let (handler, events) = capture();
    let lang = Lang::with_transport(
        ProviderConfig::new(Provider::Google, "model").with_usage_handler(handler),
        Arc::new(Pending),
    )
    .unwrap();
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_millis(20),
            lang.ask("hi", &ChatOptions::default())
        )
        .await
        .is_err()
    );
    assert_eq!(events.lock().unwrap().len(), 1);
    assert_eq!(events.lock().unwrap()[0].usage.counts["inputTokens"], 11.0);
}

#[tokio::test]
async fn synthesis_uses_billed_header_units_even_if_audio_delivery_fails() {
    use async_trait::async_trait;
    use futures_util::StreamExt;
    struct Headers;
    #[async_trait]
    impl HttpTransport for Headers {
        async fn send(&self, _: HttpRequest) -> Result<HttpResponse> {
            Ok(HttpResponse {
                status: 200,
                headers: [
                    ("character-cost".into(), "3".into()),
                    ("request-id".into(), "tts-1".into()),
                ]
                .into(),
                body: futures_util::stream::once(async {
                    Err(Error::Protocol("audio disconnected".into()))
                })
                .boxed(),
            })
        }
    }
    let (handler, events) = capture();
    let speech = Speech::with_transport("key", "https://test/v1", Arc::new(Headers))
        .with_usage_handler(handler);
    let mut audio = speech
        .speak_elevenlabs("hello", "model", "voice", 24000, CancellationToken::new())
        .await
        .unwrap();
    assert!(audio.next().await.unwrap().is_err());
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].usage.counts["characters"], 3.0);
    assert_eq!(events[0].operation, "speech-synthesis");
    assert_eq!(events[0].request_id.as_deref(), Some("tts-1"));
}
