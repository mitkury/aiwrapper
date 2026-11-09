#![cfg(feature = "catalog")]
mod common;
use aiwrapper::aimodels::{Capability, ContextKind, Model};
use aiwrapper::*;
use common::*;
use serde_json::{Value, json};
use std::sync::Arc;

fn anthropic_text() -> String {
    sse(vec![
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"message_stop"}),
    ])
}
fn google_text() -> String {
    sse(vec![
        json!({"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}),
    ])
}
fn responses_text() -> String {
    sse(vec![
        json!({"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}}),
    ])
}

/// Sends one prompt to `model` and returns the request body.
async fn request(
    provider: Provider,
    model: &str,
    options: &ChatOptions,
    response: String,
) -> Value {
    let transport = Fixture::new(vec![(200, response)]);
    let lang = Lang::with_transport(
        ProviderConfig::new(provider, model).with_api_key("test-key"),
        transport.clone(),
    )
    .unwrap();
    lang.ask("Hi", options).await.unwrap();
    let requests = transport.requests.lock().unwrap();
    requests[0].1.clone()
}

fn first(models: impl IntoIterator<Item = &'static Model>, what: &str) -> &'static Model {
    models
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("no {what} in the catalog"))
}

#[test]
fn reexports_the_catalog() {
    let model = models().id("gpt-5.1").unwrap();
    assert_eq!(model.id_for("openrouter"), Some("openai/gpt-5.1"));
    assert!(
        !models()
            .from_creator("google")
            .can(&[Capability::Chat])
            .is_empty()
    );
}

#[tokio::test]
async fn anthropic_requests_the_catalog_output_limit() {
    let model = first(
        models()
            .from_provider("anthropic")
            .filter(|m| m.context().is_some_and(|c| c.output_is_fixed)),
        "fixed-output Anthropic model",
    );
    let max_output = model.context().unwrap().max_output.unwrap();

    let body = request(
        Provider::Anthropic,
        model.id(),
        &ChatOptions::default(),
        anthropic_text(),
    )
    .await;
    assert_eq!(body["max_tokens"], json!(max_output));

    let options = ChatOptions {
        max_tokens: Some(100),
        ..ChatOptions::default()
    };
    let body = request(Provider::Anthropic, model.id(), &options, anthropic_text()).await;
    assert_eq!(body["max_tokens"], 100);

    let body = request(
        Provider::Anthropic,
        "unknown-model",
        &ChatOptions::default(),
        anthropic_text(),
    )
    .await;
    assert_eq!(body["max_tokens"], 4096);
}

#[tokio::test]
async fn shared_context_models_leave_room_for_the_input() {
    let model = first(
        models().from_provider("google").filter(|m| {
            m.context().is_some_and(|c| {
                c.kind == ContextKind::Token
                    && !c.output_is_fixed
                    && c.total.is_some()
                    && c.max_output.is_some()
            })
        }),
        "shared-context Google model",
    );
    let context = model.context().unwrap();
    let expected = context.max_output.unwrap().min(context.total.unwrap() - 5);

    let body = request(
        Provider::Google,
        model.id(),
        &ChatOptions::default(),
        google_text(),
    )
    .await;
    assert_eq!(body["generationConfig"]["maxOutputTokens"], json!(expected));

    let body = request(
        Provider::Google,
        "unknown-model",
        &ChatOptions::default(),
        google_text(),
    )
    .await;
    assert!(body["generationConfig"].get("maxOutputTokens").is_none());
}

#[tokio::test]
async fn chat_completions_find_models_by_provider_id() {
    let model = models().id("gpt-5.1").unwrap();
    let body = request(
        Provider::Openrouter,
        "openai/gpt-5.1",
        &ChatOptions::default(),
        chat("OK"),
    )
    .await;
    assert!(body["max_tokens"].as_u64().unwrap() > 0);
    assert!(body["max_tokens"].as_u64().unwrap() <= model.context().unwrap().max_output.unwrap());

    let body = request(
        Provider::Openrouter,
        "vendor/unknown",
        &ChatOptions::default(),
        chat("OK"),
    )
    .await;
    assert!(body.get("max_tokens").is_none());
}

#[tokio::test]
async fn responses_send_reasoning_only_to_reasoning_models() {
    let reasoning = first(
        models()
            .from_provider("openai")
            .can(&[Capability::Chat, Capability::Reason]),
        "OpenAI reasoning model",
    );
    let plain = first(
        models()
            .from_provider("openai")
            .can(&[Capability::Chat])
            .filter(|m| !m.can(&[Capability::Reason])),
        "OpenAI model without reasoning",
    );

    let body = request(
        Provider::Openai,
        reasoning.id(),
        &ChatOptions::default(),
        responses_text(),
    )
    .await;
    assert_eq!(
        body["reasoning"],
        json!({"effort":"medium","summary":"auto"})
    );
    // Responses output stays unbounded unless the caller sets a limit.
    assert!(body.get("max_output_tokens").is_none());

    let options = ChatOptions {
        body: [("reasoning".to_owned(), json!({"effort":"high"}))].into(),
        ..ChatOptions::default()
    };
    let body = request(Provider::Openai, reasoning.id(), &options, responses_text()).await;
    assert_eq!(body["reasoning"], json!({"effort":"high"}));

    for model in [plain.id(), "unknown-model"] {
        let body = request(
            Provider::Openai,
            model,
            &ChatOptions::default(),
            responses_text(),
        )
        .await;
        assert!(body.get("reasoning").is_none(), "{model}");
    }
}

#[tokio::test]
async fn agents_use_the_same_defaults() {
    let model = first(
        models()
            .from_provider("anthropic")
            .filter(|m| m.context().is_some_and(|c| c.output_is_fixed)),
        "fixed-output Anthropic model",
    );
    let transport = Fixture::new(vec![(200, anthropic_text())]);
    let lang = Lang::with_transport(
        ProviderConfig::new(Provider::Anthropic, model.id()).with_api_key("test-key"),
        transport.clone(),
    )
    .unwrap();
    let mut agent = ChatAgent::new(Arc::new(lang));
    agent
        .run(
            vec![Message::user("Hi")],
            &ChatOptions::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(
        requests[0].1["max_tokens"],
        json!(model.context().unwrap().max_output.unwrap())
    );
}
