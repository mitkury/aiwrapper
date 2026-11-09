//! Development host adapter. One JSON request on stdin, NDJSON snapshots on stdout.
//! This example is not a server and is not needed when embedding the crate.
use aiwrapper::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    sync::Arc,
};

#[derive(Deserialize)]
struct Request {
    provider: Provider,
    model: String,
    messages: Vec<Message>,
}
fn emit(value: Value) {
    println!("{value}");
    let _ = std::io::stdout().flush();
}
fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}
#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        emit(json!({"done":true,"error":error.to_string()}));
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin()
        .take(8 * 1024 * 1024 + 1)
        .read_to_string(&mut input)
        .map_err(|e| Error::Invalid(e.to_string()))?;
    if input.len() > 8 * 1024 * 1024 {
        return Err(Error::Invalid("sandbox request exceeds 8 MiB".into()));
    }
    let request: Request = serde_json::from_str(&input)?;
    let prefix = match request.provider {
        Provider::Openai => "OPENAI",
        Provider::OpenaiCompatible => "OPENAI_COMPATIBLE",
        Provider::Anthropic => "ANTHROPIC",
        Provider::Google => "GOOGLE",
        Provider::Ollama => "OLLAMA",
        Provider::Groq => "GROQ",
        Provider::Deepseek => "DEEPSEEK",
        Provider::Kimi => "KIMI",
        Provider::Xai => "XAI",
        Provider::Cohere => "COHERE",
        Provider::Mistral => "MISTRAL",
        Provider::Openrouter => "OPENROUTER",
    };
    let mut config = ProviderConfig::new(request.provider, request.model);
    config.api_key = env(&format!("{prefix}_API_KEY"));
    if let Some(url) = env(&format!("{prefix}_BASE_URL")).or_else(|| {
        if request.provider == Provider::Ollama {
            env("OLLAMA_URL")
        } else {
            None
        }
    }) {
        config.base_url = url;
    }
    let provider: Arc<dyn LanguageProvider> =
        if env("AIWRAPPER_NATIVE_MOCK").as_deref() == Some("1") {
            Arc::new(MockLang::interactive())
        } else {
            Arc::new(Lang::new(config)?)
        };
    let mut agent = ChatAgent::new(provider);
    agent.conversation.messages = request.messages;
    agent.tools = vec![
        Tool::new(
            "add",
            "Add two numbers",
            json!({"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"],"additionalProperties":false}),
            |args, _| async move {
                Ok(json!(
                    args["a"].as_f64().unwrap() + args["b"].as_f64().unwrap()
                ))
            },
        ),
        Tool::new(
            "get_time",
            "Get the current Unix time",
            json!({"type":"object","properties":{},"additionalProperties":false}),
            |_, _| async {
                Ok(
                    json!({"unixSeconds":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()}),
                )
            },
        ),
    ];
    if let Some(budget) = env("AIWRAPPER_COMPRESSION_TOKENS") {
        agent.compression =
            Some(Compression::new(budget.parse().map_err(|_| {
                Error::Invalid("invalid compression budget".into())
            })?)?);
    }
    let mut snapshots = agent.conversation.messages.clone();
    let outcome = agent
        .run(vec![], &ChatOptions::default(), &mut |event| match event {
            AgentEvent::Streaming { message, index }
            | AgentEvent::ToolResult { message, index } => {
                if index == snapshots.len() {
                    snapshots.push(message);
                } else {
                    snapshots[index] = message;
                }
                emit(json!({"messages":snapshots}));
            }
            AgentEvent::Compressed { checkpoint } => {
                emit(json!({"messages":snapshots,"compression":checkpoint}))
            }
            _ => {}
        })
        .await
        .err()
        .map(|e| e.to_string());
    emit(json!({"messages":agent.conversation.messages,"done":true,"error":outcome}));
    Ok(())
}
