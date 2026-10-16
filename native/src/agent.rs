use crate::*;
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AgentEvent {
    State { running: bool },
    Streaming { message: Message, index: usize },
    ToolResult { message: Message, index: usize },
    Compressed { checkpoint: CompressionCheckpoint },
    Finished,
    Aborted,
    Error { message: String },
}

/// One mutable agent per conversation. Rust's exclusive borrow prevents concurrent runs.
/// A shared provider/client can serve many independent agents.
pub struct ChatAgent {
    provider: Arc<dyn LanguageProvider>,
    pub conversation: Conversation,
    pub tools: Vec<Tool>,
    pub max_iterations: usize,
    pub compression: Option<Compression>,
}

impl ChatAgent {
    pub fn new(provider: Arc<dyn LanguageProvider>) -> Self {
        Self {
            provider,
            conversation: Conversation::default(),
            tools: vec![],
            max_iterations: 8,
            compression: None,
        }
    }
    pub async fn run(
        &mut self,
        input: Vec<Message>,
        options: &ChatOptions,
        on_event: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<&Conversation> {
        if self.max_iterations == 0 {
            return Err(Error::Invalid("max_iterations must be positive".into()));
        }
        crate::error::check_cancel(&options.cancellation)?;
        let mut names = std::collections::HashSet::new();
        for tool in &self.tools {
            if tool.definition.name.is_empty() || !names.insert(&tool.definition.name) {
                return Err(Error::Invalid(
                    "tool names must be non-empty and unique".into(),
                ));
            }
            jsonschema::validator_for(&tool.definition.parameters)
                .map_err(|e| Error::Schema(e.to_string()))?;
        }
        self.conversation.messages.extend(input);
        self.conversation.finished = false;
        self.conversation.aborted = false;
        on_event(AgentEvent::State { running: true });
        let result = self.run_inner(options, on_event).await;
        match &result {
            Ok(()) => {
                self.conversation.finished = true;
                on_event(AgentEvent::Finished);
            }
            Err(Error::Cancelled) => {
                self.conversation.aborted = true;
                on_event(AgentEvent::Aborted);
            }
            Err(error) => on_event(AgentEvent::Error {
                message: error.to_string(),
            }),
        }
        on_event(AgentEvent::State { running: false });
        result?;
        Ok(&self.conversation)
    }
    async fn run_inner(
        &mut self,
        options: &ChatOptions,
        on_event: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<()> {
        let mut options = options.clone();
        // An explicitly supplied tool definition list restricts which registered handlers are offered.
        if options.tools.is_none() {
            options.tools = Some(self.tools.iter().map(|t| t.definition.clone()).collect());
        }
        for _ in 0..self.max_iterations {
            crate::error::check_cancel(&options.cancellation)?;
            self.conversation.validate()?;
            let context = if let Some(compression) = &mut self.compression {
                let previous = compression.checkpoint.clone();
                let context = compression
                    .prepare(self.provider.as_ref(), &self.conversation, &options)
                    .await?;
                if previous != compression.checkpoint {
                    on_event(AgentEvent::Compressed {
                        checkpoint: compression.checkpoint.clone().unwrap(),
                    });
                }
                context
            } else {
                self.conversation.clone()
            };
            let index = self.conversation.messages.len();
            let messages = &mut self.conversation.messages;
            let response = self
                .provider
                .complete(&context, &options, &mut |message| {
                    if messages.len() == index {
                        messages.push(message.clone());
                    } else {
                        messages[index] = message.clone();
                    }
                    on_event(AgentEvent::Streaming {
                        message: message.clone(),
                        index,
                    });
                })
                .await?;
            if messages.len() == index {
                messages.push(response.clone());
            } else {
                messages[index] = response.clone();
            }
            on_event(AgentEvent::Streaming {
                message: response.clone(),
                index,
            });
            if response.role != Role::Assistant {
                return Err(Error::Protocol(
                    "provider returned a non-assistant message".into(),
                ));
            }
            let calls: Vec<_> = response
                .items
                .iter()
                .filter_map(|item| match item {
                    Item::Tool {
                        call_id,
                        name,
                        arguments,
                        ..
                    } => Some((call_id.clone(), name.clone(), arguments.clone())),
                    _ => None,
                })
                .collect();
            if calls.is_empty() {
                return Ok(());
            }
            // Validate complete calls before executing anything with side effects.
            let mut seen: std::collections::HashSet<String> = self.conversation.messages[..index]
                .iter()
                .flat_map(|m| m.items.iter())
                .filter_map(|i| match i {
                    Item::Tool { call_id, .. } => Some(call_id.clone()),
                    _ => None,
                })
                .collect();
            for (id, name, args) in &calls {
                if id.is_empty() || name.is_empty() || !args.is_object() || !seen.insert(id.clone())
                {
                    return Err(Error::Protocol("invalid or duplicate tool call".into()));
                }
            }
            for (call_id, name, arguments) in calls {
                crate::error::check_cancel(&options.cancellation)?;
                let handler = self.tools.iter().find(|t| {
                    t.definition.name == name
                        && options.tool_definitions().iter().any(|d| d.name == name)
                });
                let outcome = match handler {
                    Some(tool) => {
                        tool.execute(
                            arguments,
                            ToolContext {
                                call_id: call_id.clone(),
                                name: name.clone(),
                                cancellation: options.cancellation.clone(),
                            },
                        )
                        .await
                    }
                    None => Err(Error::Tool(format!("unknown or disabled tool: {name}"))),
                };
                // A cancellation result is still explicit history; previously completed tools remain intact.
                let cancelled = matches!(outcome, Err(Error::Cancelled));
                let result = match outcome {
                    Ok(value) => value,
                    Err(error) => json!({"error":error.to_string(),"cancelled":cancelled}),
                };
                let item = Item::ToolResult {
                    call_id,
                    name,
                    result,
                };
                if self
                    .conversation
                    .messages
                    .last()
                    .is_some_and(|m| m.role == Role::ToolResults)
                {
                    self.conversation
                        .messages
                        .last_mut()
                        .unwrap()
                        .items
                        .push(item);
                } else {
                    self.conversation
                        .messages
                        .push(Message::new(Role::ToolResults, vec![item]));
                }
                let index = self.conversation.messages.len() - 1;
                on_event(AgentEvent::ToolResult {
                    message: self.conversation.messages[index].clone(),
                    index,
                });
                if cancelled {
                    return Err(Error::Cancelled);
                }
            }
        }
        Err(Error::IterationLimit(self.max_iterations))
    }
}
