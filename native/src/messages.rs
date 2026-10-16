use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    User,
    Assistant,
    ToolResults,
}

/// JSON compatible with the TypeScript `LangMessage.items` contract.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Item {
    Text {
        text: String,
    },
    Reasoning {
        text: String,
    },
    Image {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        base64: Option<String>,
        #[serde(default, rename = "mimeType", skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
    },
    Tool {
        #[serde(rename = "callId")]
        call_id: String,
        name: String,
        arguments: Value,
        #[serde(
            default,
            rename = "thoughtSignature",
            skip_serializing_if = "Option::is_none"
        )]
        thought_signature: Option<String>,
    },
    ToolResult {
        #[serde(rename = "callId")]
        call_id: String,
        name: String,
        result: Value,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub items: Vec<Item>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

impl Message {
    pub fn new(role: Role, items: Vec<Item>) -> Self {
        Self {
            role,
            items,
            meta: None,
        }
    }
    pub fn text(role: Role, text: impl Into<String>) -> Self {
        Self::new(role, vec![Item::Text { text: text.into() }])
    }
    pub fn user(text: impl Into<String>) -> Self {
        Self::text(Role::User, text)
    }
    pub fn assistant(text: impl Into<String>) -> Self {
        Self::text(Role::Assistant, text)
    }
    pub fn answer(&self) -> String {
        self.items
            .iter()
            .filter_map(|item| match item {
                Item::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }
    pub fn has_tools(&self) -> bool {
        self.items.iter().any(|i| matches!(i, Item::Tool { .. }))
    }
}

/// Persist this value; handlers and credentials are deliberately not serializable.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub instructions: String,
    #[serde(default)]
    pub finished: bool,
    #[serde(default)]
    pub aborted: bool,
}

impl Conversation {
    pub fn new(prompt: impl Into<String>) -> Self {
        Self {
            messages: vec![Message::user(prompt)],
            ..Self::default()
        }
    }
    pub fn answer(&self) -> String {
        self.messages
            .iter()
            .rev()
            .find(|m| m.role == Role::Assistant)
            .map(Message::answer)
            .unwrap_or_default()
    }
    pub fn object(&self) -> Result<Value> {
        Ok(serde_json::from_str(&self.answer())?)
    }
    /// Reject incomplete/duplicate pairs instead of inventing successful tool outcomes.
    pub fn validate(&self) -> Result<()> {
        use std::collections::HashSet;
        let mut pending = HashSet::new();
        let mut seen = HashSet::new();
        for message in &self.messages {
            if message.role != Role::ToolResults && !pending.is_empty() {
                return Err(Error::Invalid(
                    "unresolved tool calls before the next message".into(),
                ));
            }
            for item in &message.items {
                match item {
                    Item::Tool {
                        call_id,
                        name,
                        arguments,
                        ..
                    } => {
                        if message.role != Role::Assistant
                            || call_id.is_empty()
                            || name.is_empty()
                            || !arguments.is_object()
                            || !seen.insert(call_id.clone())
                        {
                            return Err(Error::Invalid("invalid or duplicate tool call".into()));
                        }
                        pending.insert(call_id.clone());
                    }
                    Item::ToolResult { call_id, .. } => {
                        if message.role != Role::ToolResults || !pending.remove(call_id) {
                            return Err(Error::Invalid("tool result has no matching call".into()));
                        }
                    }
                    Item::Image { url, base64, .. } if url.is_some() == base64.is_some() => {
                        return Err(Error::Invalid(
                            "image requires exactly one of url or base64".into(),
                        ));
                    }
                    _ => {}
                }
            }
        }
        if !pending.is_empty() {
            return Err(Error::Invalid(
                "unresolved tool calls; supply explicit results before resuming".into(),
            ));
        }
        Ok(())
    }
}

pub(crate) fn image_url(
    url: &Option<String>,
    base64: &Option<String>,
    mime: &Option<String>,
) -> Result<String> {
    match (url, base64) {
        (Some(url), None) if !url.is_empty() => Ok(url.clone()),
        (None, Some(data)) if !data.is_empty() => Ok(format!(
            "data:{};base64,{data}",
            mime.as_deref().unwrap_or("image/png")
        )),
        _ => Err(Error::Invalid(
            "image requires a non-empty URL or base64 data".into(),
        )),
    }
}
