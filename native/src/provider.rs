mod request;
mod response;

use crate::{
    CancellationToken, Conversation, Error, HttpRequest, HttpTransport, Message, ReqwestTransport,
    Result, ToolDefinition,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc, time::Duration};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provider {
    Openai,
    OpenaiCompatible,
    Anthropic,
    Google,
    Ollama,
    Groq,
    Deepseek,
    Kimi,
    Xai,
    Cohere,
    Mistral,
    Openrouter,
}

impl Provider {
    pub fn base_url(self) -> &'static str {
        match self {
            Self::Openai | Self::OpenaiCompatible => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com/v1",
            Self::Google => "https://generativelanguage.googleapis.com/v1beta",
            Self::Ollama => "http://localhost:11434",
            Self::Groq => "https://api.groq.com/openai/v1",
            Self::Deepseek => "https://api.deepseek.com",
            Self::Kimi => "https://api.moonshot.ai/v1",
            Self::Xai => "https://api.x.ai/v1",
            Self::Cohere => "https://api.cohere.com/v2",
            Self::Mistral => "https://api.mistral.ai/v1",
            Self::Openrouter => "https://openrouter.ai/api/v1",
        }
    }
}

/// Explicit model selection; no network catalog lookup or hidden environment reads.
#[derive(Clone)]
pub struct ProviderConfig {
    pub provider: Provider,
    pub model: String,
    pub api_key: Option<String>,
    pub base_url: String,
    pub headers: BTreeMap<String, String>,
    pub body: BTreeMap<String, Value>,
}

impl ProviderConfig {
    pub fn new(provider: Provider, model: impl Into<String>) -> Self {
        Self {
            provider,
            model: model.into(),
            api_key: None,
            base_url: provider.base_url().into(),
            headers: BTreeMap::new(),
            body: BTreeMap::new(),
        }
    }
    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
        self
    }
}

#[derive(Clone)]
pub struct ChatOptions {
    pub cancellation: CancellationToken,
    /// None uses agent tools; Some(vec![]) explicitly disables them.
    pub tools: Option<Vec<ToolDefinition>>,
    /// Provider-owned tool definitions (for example Responses web_search).
    pub built_in_tools: Vec<Value>,
    pub schema: Option<Value>,
    pub max_tokens: Option<u32>,
    pub body: BTreeMap<String, Value>,
    pub headers: BTreeMap<String, String>,
    /// Retries only rejected HTTP requests, never a stream or a tool execution.
    pub max_retries: u8,
}

impl ChatOptions {
    pub fn tool_definitions(&self) -> &[ToolDefinition] {
        self.tools.as_deref().unwrap_or_default()
    }
}

impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            cancellation: CancellationToken::new(),
            tools: None,
            built_in_tools: vec![],
            schema: None,
            max_tokens: None,
            body: BTreeMap::new(),
            headers: BTreeMap::new(),
            max_retries: 2,
        }
    }
}

/// One model turn. Tool execution is owned by ChatAgent or by the application.
#[async_trait]
pub trait LanguageProvider: Send + Sync {
    async fn complete(
        &self,
        conversation: &Conversation,
        options: &ChatOptions,
        on_update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<Message>;
}

pub struct Lang {
    pub config: ProviderConfig,
    transport: Arc<dyn HttpTransport>,
}

impl Lang {
    pub fn new(config: ProviderConfig) -> Result<Self> {
        Self::with_transport(config, Arc::new(ReqwestTransport::new()?))
    }
    pub fn with_transport(
        config: ProviderConfig,
        transport: Arc<dyn HttpTransport>,
    ) -> Result<Self> {
        if config.model.trim().is_empty() {
            return Err(Error::Invalid("model is required".into()));
        }
        let url = reqwest::Url::parse(&config.base_url)
            .map_err(|_| Error::Invalid("invalid base URL".into()))?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(Error::Invalid(
                "base URL must be HTTP(S), without credentials, query or fragment".into(),
            ));
        }
        Ok(Self { config, transport })
    }
    pub async fn ask(
        &self,
        prompt: impl Into<String>,
        options: &ChatOptions,
    ) -> Result<Conversation> {
        let mut conversation = Conversation::new(prompt);
        self.chat(&mut conversation, options, &mut |_| {}).await?;
        Ok(conversation)
    }
    /// Appends streaming partial output even when cancellation or a protocol error occurs.
    pub async fn chat(
        &self,
        conversation: &mut Conversation,
        options: &ChatOptions,
        on_update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<()> {
        conversation.finished = false;
        conversation.aborted = false;
        let input = conversation.clone();
        let index = conversation.messages.len();
        let result = self
            .complete(&input, options, &mut |message| {
                if conversation.messages.len() == index {
                    conversation.messages.push(message.clone());
                } else {
                    conversation.messages[index] = message.clone();
                }
                on_update(message);
            })
            .await;
        match result {
            Ok(message) => {
                if conversation.messages.len() == index {
                    conversation.messages.push(message);
                } else {
                    conversation.messages[index] = message;
                }
                conversation.finished = true;
                Ok(())
            }
            Err(error) => {
                conversation.aborted = matches!(error, Error::Cancelled);
                Err(error)
            }
        }
    }
}

#[async_trait]
impl LanguageProvider for Lang {
    async fn complete(
        &self,
        conversation: &Conversation,
        options: &ChatOptions,
        on_update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<Message> {
        crate::error::check_cancel(&options.cancellation)?;
        conversation.validate()?;
        if let Some(schema) = &options.schema {
            jsonschema::validator_for(schema).map_err(|e| Error::Schema(e.to_string()))?;
        }
        let (path, body) = request::build(&self.config, conversation, options)?;
        let mut headers = BTreeMap::from([
            ("content-type".into(), "application/json".into()),
            ("accept".into(), "text/event-stream".into()),
        ]);
        if let Some(key) = &self.config.api_key {
            match self.config.provider {
                Provider::Anthropic => {
                    headers.insert("x-api-key".into(), key.clone());
                }
                Provider::Google => {
                    headers.insert("x-goog-api-key".into(), key.clone());
                }
                _ => {
                    headers.insert("authorization".into(), format!("Bearer {key}"));
                }
            }
        }
        if self.config.provider == Provider::Anthropic {
            headers.insert("anthropic-version".into(), "2023-06-01".into());
        }
        headers.extend(self.config.headers.clone());
        headers.extend(options.headers.clone());
        let body = serde_json::to_vec(&body)?;
        let url = format!("{}{path}", self.config.base_url.trim_end_matches('/'));
        for attempt in 0..=options.max_retries {
            let response = tokio::select! {
                biased;
                _ = options.cancellation.cancelled() => return Err(Error::Cancelled),
                response = self.transport.send(HttpRequest { url: url.clone(), headers: headers.clone(), body: body.clone() }) => response?,
            };
            if !(200..300).contains(&response.status) {
                let status = response.status;
                let retry_delay = response
                    .headers
                    .get("retry-after")
                    .and_then(|v| v.parse::<u64>().ok())
                    .map(|s| s.min(30) * 1000)
                    .unwrap_or(250 * (1u64 << attempt.min(6)));
                let bytes = tokio::select! {
                    _ = options.cancellation.cancelled() => return Err(Error::Cancelled),
                    bytes = crate::transport::read_body(response, 64 * 1024) => bytes?,
                };
                if attempt < options.max_retries && matches!(status, 429 | 502 | 503 | 504) {
                    tokio::select! {
                        _ = options.cancellation.cancelled() => return Err(Error::Cancelled),
                        _ = tokio::time::sleep(Duration::from_millis(retry_delay)) => {}
                    }
                    continue;
                }
                return Err(Error::Http {
                    status,
                    body: String::from_utf8_lossy(&bytes).into_owned(),
                });
            }
            let mut decoder = response::Decoder::new(self.config.provider);
            crate::stream::read(
                response,
                self.config.provider == Provider::Ollama,
                &options.cancellation,
                &mut |value| decoder.push(value, on_update),
            )
            .await?;
            crate::error::check_cancel(&options.cancellation)?;
            let message = decoder.finish()?;
            if !message.has_tools()
                && let Some(schema) = &options.schema
            {
                let value: Value = serde_json::from_str(&message.answer())?;
                crate::tools::validate_schema(schema, &value)?;
            }
            return Ok(message);
        }
        unreachable!()
    }
}

pub(crate) fn output_text(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}
