use crate::*;
use async_trait::async_trait;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::VecDeque, sync::Mutex};

type Responder = dyn Fn(&Conversation, &ChatOptions) -> Result<Message> + Send + Sync;

/// Offline provider with scripted or request-dependent replies. No network or timers.
pub struct MockLang {
    respond: Box<Responder>,
}

impl MockLang {
    /// Consume fixed replies in order; exhaustion is an error.
    pub fn new(replies: impl IntoIterator<Item = Message>) -> Self {
        let replies = Mutex::new(replies.into_iter().collect::<VecDeque<_>>());
        Self::from_fn(move |_, _| {
            replies
                .lock()
                .map_err(|_| Error::Protocol("mock lock poisoned".into()))?
                .pop_front()
                .ok_or_else(|| Error::Protocol("mock replies exhausted".into()))
        })
    }

    /// Inspect real model input and return a reply or error. The callback is
    /// synchronous; capture a Mutex or atomics if a fixture needs shared state.
    pub fn from_fn(
        respond: impl Fn(&Conversation, &ChatOptions) -> Result<Message> + Send + Sync + 'static,
    ) -> Self {
        Self {
            respond: Box::new(respond),
        }
    }

    /// Echo user text or request `tool: <name> <JSON object>`, then report the
    /// actual tool results. Conversation state is supplied by the caller.
    /// Use `from_fn` for summary fixtures and structured-output scenarios.
    pub fn interactive() -> Self {
        Self::from_fn(interactive_reply)
    }
}

#[async_trait]
impl LanguageProvider for MockLang {
    async fn complete(
        &self,
        conversation: &Conversation,
        options: &ChatOptions,
        on_update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<Message> {
        crate::error::check_cancel(&options.cancellation)?;
        conversation.validate()?;
        if let Some(schema) = &options.schema {
            jsonschema::validator_for(schema).map_err(|error| Error::Schema(error.to_string()))?;
        }
        let message = (self.respond)(conversation, options)?;
        // Text snapshots exercise cancellation and partial-history handling.
        // Tool requests remain atomic: only complete arguments can be executed.
        let mut partial = Message::new(message.role, vec![]);
        for item in &message.items {
            match item {
                Item::Text { text } | Item::Reasoning { text } if !text.is_empty() => {
                    let mut accumulated = String::new();
                    let mut characters = text.chars().peekable();
                    while characters.peek().is_some() {
                        accumulated.extend(characters.by_ref().take(32));
                        let item = if matches!(item, Item::Text { .. }) {
                            Item::Text {
                                text: accumulated.clone(),
                            }
                        } else {
                            Item::Reasoning {
                                text: accumulated.clone(),
                            }
                        };
                        partial.items.push(item);
                        crate::error::check_cancel(&options.cancellation)?;
                        on_update(&partial);
                        tokio::task::yield_now().await;
                        partial.items.pop();
                    }
                }
                _ => {}
            }
            partial.items.push(item.clone());
        }
        crate::error::check_cancel(&options.cancellation)?;
        if partial != message
            || !matches!(message.items.last(), Some(Item::Text { text } | Item::Reasoning { text }) if !text.is_empty())
        {
            on_update(&message);
        }
        crate::error::check_cancel(&options.cancellation)?;
        if !message.has_tools()
            && let Some(schema) = &options.schema
        {
            crate::tools::validate_schema(schema, &serde_json::from_str(&message.answer())?)?;
        }
        Ok(message)
    }
}

fn interactive_reply(conversation: &Conversation, options: &ChatOptions) -> Result<Message> {
    if conversation.instructions == crate::compression::SUMMARY_INSTRUCTIONS
        || options.schema.is_some()
    {
        return Err(Error::Unsupported(
            "use MockLang::from_fn for explicit summary or structured-output fixtures".into(),
        ));
    }
    let Some(last) = conversation.messages.last() else {
        return Ok(Message::assistant(
            "Mock ready. Send text or tool: <name> <JSON object>.",
        ));
    };
    if last.role == Role::ToolResults {
        let mut output = vec![];
        // Include separate result messages from a parallel tool group too.
        let start = conversation
            .messages
            .iter()
            .rposition(|m| m.role != Role::ToolResults)
            .map_or(0, |i| i + 1);
        for message in &conversation.messages[start..] {
            for item in &message.items {
                if let Item::ToolResult { name, result, .. } = item {
                    output.push(format!(
                        "Tool result: {name}\n{}",
                        serde_json::to_string_pretty(result)?
                    ));
                }
            }
        }
        return Ok(Message::assistant(output.join("\n\n")));
    }
    let text = last.answer();
    if last.role == Role::User
        && let Some(command) = text.trim().strip_prefix("tool:")
    {
        let parsed =
            command
                .trim()
                .split_once(char::is_whitespace)
                .and_then(|(name, arguments)| {
                    serde_json::from_str::<Value>(arguments)
                        .ok()
                        .filter(Value::is_object)
                        .map(|args| (name, args))
                });
        let Some((name, arguments)) = parsed else {
            return Ok(Message::assistant(
                "Invalid mock tool command. Use tool: <name> <JSON object>.",
            ));
        };
        if !options
            .tool_definitions()
            .iter()
            .any(|tool| tool.name == name)
        {
            return Ok(Message::assistant(format!("Mock tool unavailable: {name}")));
        }
        // Identical input gives an identical call id, including after a restart.
        let id = format!(
            "mock-{:x}",
            Sha256::digest(serde_json::to_vec(conversation)?)
        );
        return Ok(Message::new(
            Role::Assistant,
            vec![Item::Tool {
                call_id: id,
                name: name.into(),
                arguments,
                thought_signature: None,
            }],
        ));
    }
    Ok(Message::assistant(format!("Mock reply: {text}")))
}
