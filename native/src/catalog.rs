//! Model metadata from the embedded AIModels catalog.
//!
//! Model IDs stay explicit: the catalog only fills in defaults for models it
//! knows, and unknown IDs keep the provider defaults.

use crate::{Conversation, Item, ProviderConfig};

#[cfg(feature = "catalog")]
pub use aimodels::models;

/// Catalog facts a request builder uses.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ModelInfo {
    /// Output tokens to request when the caller sets no `max_tokens`.
    pub response_tokens: Option<u32>,
    /// Whether the model accepts reasoning parameters.
    pub can_reason: bool,
}

/// Looks the configured model up by catalog ID or alias, then by the ID the
/// provider uses for it (for example `openai/gpt-5.1` on OpenRouter).
#[cfg(feature = "catalog")]
pub(crate) fn lookup(config: &ProviderConfig, conversation: &Conversation) -> Option<ModelInfo> {
    let id = config.model.trim_start_matches("models/");
    let model = models()
        .id(id)
        .or_else(|| models().from_provider_id(config.provider.as_str(), id))?;
    Some(ModelInfo {
        response_tokens: Some(response_tokens(
            model.context(),
            estimate_input_tokens(conversation),
        )),
        can_reason: model.can(&[aimodels::Capability::Reason]),
    })
}

#[cfg(not(feature = "catalog"))]
pub(crate) fn lookup(_: &ProviderConfig, _: &Conversation) -> Option<ModelInfo> {
    None
}

/// Rough estimate: one token per four characters of message text, plus four
/// tokens of overhead per message with text. Instructions are not counted.
#[cfg_attr(not(feature = "catalog"), allow(dead_code))]
fn estimate_input_tokens(conversation: &Conversation) -> u64 {
    conversation
        .messages
        .iter()
        .map(|message| {
            let texts: Vec<&str> = message
                .items
                .iter()
                .filter_map(|item| match item {
                    Item::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect();
            let chars = texts.iter().map(|t| t.chars().count()).sum::<usize>()
                + texts.len().saturating_sub(1) * 2;
            if chars == 0 {
                0
            } else {
                chars.div_ceil(4) as u64 + 4
            }
        })
        .sum()
}

/// Output tokens to request for a model with no caller-set limit: the full
/// `maxOutput` when output is fixed, otherwise what fits next to the input.
#[cfg(feature = "catalog")]
fn response_tokens(context: Option<&aimodels::ModelContext>, input_tokens: u64) -> u32 {
    const FALLBACK: u64 = 4000;
    let tokens = match context {
        Some(context) if context.kind == aimodels::ContextKind::Token => {
            match (context.total, context.max_output) {
                (_, Some(max_output)) if context.output_is_fixed && max_output > 0 => max_output,
                (Some(total), Some(max_output)) if total > 0 && max_output > 0 => {
                    max_output.min(total.saturating_sub(input_tokens))
                }
                (_, max_output) => max_output.filter(|&m| m > 0).unwrap_or(FALLBACK),
            }
        }
        _ => FALLBACK,
    };
    u32::try_from(tokens).unwrap_or(u32::MAX)
}

#[cfg(all(test, feature = "catalog"))]
mod tests {
    use super::*;
    use crate::{Message, Provider, Role};

    fn info(provider: Provider, model: &str, conversation: &Conversation) -> Option<ModelInfo> {
        lookup(&ProviderConfig::new(provider, model), conversation)
    }

    #[test]
    fn estimates_message_text_only() {
        let mut conversation = Conversation::new("abcdefgh");
        conversation.instructions = "ignored".repeat(100);
        conversation.messages.push(Message::new(
            Role::Assistant,
            vec![
                Item::Text { text: "abc".into() },
                Item::Reasoning {
                    text: "ignored".into(),
                },
                Item::Text { text: "def".into() },
            ],
        ));
        conversation.messages.push(Message::new(Role::User, vec![]));
        // "abcdefgh" -> 2 + 4; "abc\n\ndef" (8 chars) -> 2 + 4; empty -> 0
        assert_eq!(estimate_input_tokens(&conversation), 12);
    }

    #[test]
    fn fixed_output_models_get_their_full_output() {
        let model = models()
            .iter()
            .find(|m| m.context().is_some_and(|c| c.output_is_fixed))
            .expect("a fixed-output model");
        let max_output = model.context().unwrap().max_output.unwrap();
        let info = info(Provider::Anthropic, model.id(), &Conversation::new("Hi")).unwrap();
        assert_eq!(info.response_tokens, Some(max_output as u32));
    }

    #[test]
    fn shared_context_models_leave_room_for_the_input() {
        let model = models()
            .iter()
            .find(|m| {
                m.context().is_some_and(|c| {
                    c.kind == aimodels::ContextKind::Token
                        && !c.output_is_fixed
                        && c.total.is_some()
                        && c.max_output.is_some_and(|m| m > 1000)
                })
            })
            .expect("a shared-context model");
        let context = model.context().unwrap();
        let (total, max_output) = (context.total.unwrap(), context.max_output.unwrap());

        let short = info(Provider::Google, model.id(), &Conversation::new("Hi")).unwrap();
        assert_eq!(
            short.response_tokens,
            Some(max_output.min(total - 5) as u32)
        );

        let long_prompt = "x".repeat(((total - 100) * 4) as usize);
        let long = info(
            Provider::Google,
            model.id(),
            &Conversation::new(long_prompt),
        )
        .unwrap();
        assert_eq!(long.response_tokens, Some(96));
    }

    #[test]
    fn non_token_contexts_use_the_fallback() {
        assert_eq!(response_tokens(None, 10), 4000);
        let image = models()
            .iter()
            .find(|m| {
                m.context()
                    .is_some_and(|c| c.kind == aimodels::ContextKind::Image)
            })
            .unwrap();
        assert_eq!(response_tokens(image.context(), 10), 4000);
    }

    #[test]
    fn finds_models_by_alias_and_provider_id() {
        let conversation = Conversation::new("Hi");
        assert!(info(Provider::Openai, "gpt-5.1", &conversation).is_some());
        assert!(info(Provider::Openrouter, "openai/gpt-5.1", &conversation).is_some());
        assert!(info(Provider::Openrouter, "not-a-catalog-model", &conversation).is_none());
        assert!(info(Provider::Openai, "test-model", &conversation).is_none());
    }

    #[test]
    fn reads_reasoning_support() {
        let conversation = Conversation::new("Hi");
        let reasoning = models()
            .from_provider("openai")
            .can(&[aimodels::Capability::Reason])
            .iter()
            .next()
            .unwrap()
            .id();
        let plain = models()
            .from_provider("openai")
            .can(&[aimodels::Capability::Chat])
            .filter(|m| !m.can(&[aimodels::Capability::Reason]))
            .iter()
            .next()
            .unwrap()
            .id();
        assert!(
            info(Provider::Openai, reasoning, &conversation)
                .unwrap()
                .can_reason
        );
        assert!(
            !info(Provider::Openai, plain, &conversation)
                .unwrap()
                .can_reason
        );
    }
}
