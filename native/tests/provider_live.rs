//! Explicit opt-in: these tests make billable provider calls. Never run in default CI.
use aiwrapper::*;
use serde_json::json;
use std::sync::Arc;

#[tokio::test]
#[ignore = "requires provider credentials and makes live requests"]
async fn live_inference_tools_and_structured_output() {
    for (provider, key, model_key, default_model) in [
        (
            Provider::Openai,
            "OPENAI_API_KEY",
            "OPENAI_MODEL",
            "gpt-4.1-mini",
        ),
        (
            Provider::Google,
            "GOOGLE_API_KEY",
            "GOOGLE_MODEL",
            "gemini-3.8-flash",
        ),
        (
            Provider::Anthropic,
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_MODEL",
            "claude-haiku-4-5",
        ),
    ] {
        eprintln!("Live inference and schema: {provider:?}");
        let Ok(api_key) = std::env::var(key) else {
            panic!("{key} is required for this explicit live test")
        };
        let model = std::env::var(model_key)
            .ok()
            .filter(|m| !m.is_empty())
            .unwrap_or(default_model.into());
        let provider = Arc::new(
            Lang::new(ProviderConfig::new(provider, model).with_api_key(api_key)).unwrap(),
        );
        let mut agent = ChatAgent::new(provider.clone());
        agent.tools = vec![Tool::new(
            "add",
            "Add two integers",
            json!({"type":"object","properties":{"a":{"type":"integer"},"b":{"type":"integer"}},"required":["a","b"],"additionalProperties":false}),
            |args, _| async move {
                Ok(json!(
                    args["a"].as_i64().unwrap() + args["b"].as_i64().unwrap()
                ))
            },
        )];
        agent
            .run(
                vec![Message::user(
                    "Call the add tool with a=2 and b=3, then answer with the number only.",
                )],
                &ChatOptions::default(),
                &mut |_| {},
            )
            .await
            .unwrap();
        assert!(
            agent
                .conversation
                .messages
                .iter()
                .any(|m| m.role == Role::ToolResults)
        );
        assert!(agent.conversation.answer().contains('5'));
        let options = ChatOptions {
            schema: Some(
                json!({"type":"object","properties":{"answer":{"type":"integer"}},"required":["answer"],"additionalProperties":false}),
            ),
            ..ChatOptions::default()
        };
        let result = provider
            .ask("Return answer equal to 5.", &options)
            .await
            .unwrap();
        assert_eq!(result.object().unwrap()["answer"], 5);
    }
}
