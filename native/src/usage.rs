//! Provider-reported usage. Prices, persistence and application attribution belong to callers.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, panic::AssertUnwindSafe, sync::Arc};

pub type UsageHandler = Arc<dyn Fn(UsageEvent) + Send + Sync>;

/// Counts are optional: an absent field was not reported, rather than measured as zero.
/// Audio/image/cache/reasoning counts are subsets of the corresponding total.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(flatten)]
    pub counts: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEvent {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub usage: Usage,
    pub raw_usage: Value,
}

impl UsageEvent {
    pub fn new(provider: &str, model: &str, operation: &str, raw_usage: Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            provider: provider.into(),
            model: model.trim_start_matches("models/").into(),
            operation: operation.into(),
            request_id: None,
            usage: normalize_usage(provider, &raw_usage),
            raw_usage,
        }
    }
}

pub(crate) fn emit_usage(handler: &Option<UsageHandler>, event: UsageEvent) {
    if let Some(handler) = handler {
        // An observer cannot turn a completed, billed operation into a failed model call.
        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| handler(event)));
    }
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite() && *n >= 0.0)
}

/// Preserve provider reports separately; this projection only includes understood units.
pub fn normalize_usage(provider: &str, raw: &Value) -> Usage {
    let mut counts = BTreeMap::new();
    let mut put = |key: &str, value: Option<f64>| {
        if let Some(value) = value.filter(|n| n.is_finite() && *n >= 0.0) {
            counts.insert(key.into(), value);
        }
    };
    let n = |key: &str| number(&raw[key]);
    if provider == "google" {
        let sum = |a: &str, b: &str| match (n(a), n(b)) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
        };
        put(
            "inputTokens",
            sum("promptTokenCount", "toolUsePromptTokenCount"),
        );
        let output = n("responseTokenCount").or(n("candidatesTokenCount"));
        put(
            "outputTokens",
            match (output, n("thoughtsTokenCount")) {
                (None, None) => None,
                (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
            },
        );
        put("cachedTokens", n("cachedContentTokenCount"));
        put("reasoningTokens", n("thoughtsTokenCount"));
        let modalities = |keys: &[&str], kinds: &[&str]| {
            let mut total = None;
            for key in keys {
                for detail in raw[*key].as_array().into_iter().flatten() {
                    if kinds.iter().any(|kind| {
                        detail["modality"]
                            .as_str()
                            .is_some_and(|m| m.eq_ignore_ascii_case(kind))
                    }) && let Some(value) = number(&detail["tokenCount"])
                    {
                        *total.get_or_insert(0.0) += value;
                    }
                }
            }
            total
        };
        for (field, keys, kinds) in [
            (
                "inputAudioTokens",
                vec!["promptTokensDetails", "toolUsePromptTokensDetails"],
                vec!["AUDIO"],
            ),
            (
                "inputImageTokens",
                vec!["promptTokensDetails", "toolUsePromptTokensDetails"],
                vec!["IMAGE", "VIDEO"],
            ),
            (
                "outputAudioTokens",
                vec![if raw["responseTokensDetails"].is_array() {
                    "responseTokensDetails"
                } else {
                    "candidatesTokensDetails"
                }],
                vec!["AUDIO"],
            ),
            (
                "outputImageTokens",
                vec![if raw["responseTokensDetails"].is_array() {
                    "responseTokensDetails"
                } else {
                    "candidatesTokensDetails"
                }],
                vec!["IMAGE"],
            ),
            (
                "cachedAudioTokens",
                vec!["cacheTokensDetails"],
                vec!["AUDIO"],
            ),
            (
                "cachedImageTokens",
                vec!["cacheTokensDetails"],
                vec!["IMAGE", "VIDEO"],
            ),
        ] {
            put(field, modalities(&keys, &kinds));
        }
        if let Some(seconds) = raw["totalBilledTime"]
            .as_str()
            .and_then(|s| s.strip_suffix('s'))
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|s| s.is_finite() && *s >= 0.0)
        {
            put("audioSeconds", Some(seconds));
        }
    } else if provider == "anthropic" || provider == "bedrock" {
        let (input, output, read, write) = if provider == "bedrock" {
            (
                "inputTokens",
                "outputTokens",
                "cacheReadInputTokens",
                "cacheWriteInputTokens",
            )
        } else {
            (
                "input_tokens",
                "output_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            )
        };
        let read = n(read);
        let write = n(write);
        put(
            "inputTokens",
            match (n(input), read, write) {
                (None, None, None) => None,
                (input, read, write) => {
                    Some(input.unwrap_or(0.0) + read.unwrap_or(0.0) + write.unwrap_or(0.0))
                }
            },
        );
        put("outputTokens", n(output));
        put("cachedTokens", read);
        put("cacheWriteTokens", write);
    } else if provider == "ollama" {
        put("inputTokens", n("prompt_eval_count"));
        put("outputTokens", n("eval_count"));
    } else if provider == "cohere" {
        // Billed units can differ from the tokenizer's counts.
        put("inputTokens", number(&raw["billed_units"]["input_tokens"]));
        put(
            "outputTokens",
            number(&raw["billed_units"]["output_tokens"]),
        );
    } else {
        put(
            "inputTokens",
            n("input_tokens")
                .or(n("prompt_tokens"))
                .or(n("inputTokens")),
        );
        put(
            "outputTokens",
            n("output_tokens")
                .or(n("completion_tokens"))
                .or(n("outputTokens")),
        );
        let input = raw
            .get("input_token_details")
            .or(raw.get("input_tokens_details"))
            .or(raw.get("prompt_tokens_details"))
            .unwrap_or(&Value::Null);
        let output = raw
            .get("output_token_details")
            .or(raw.get("output_tokens_details"))
            .or(raw.get("completion_tokens_details"))
            .unwrap_or(&Value::Null);
        put(
            "cachedTokens",
            number(&input["cached_tokens"])
                .or(n("cacheReadInputTokens"))
                .or(n("prompt_cache_hit_tokens")),
        );
        put(
            "cacheWriteTokens",
            number(&input["cache_write_tokens"]).or(n("cacheWriteInputTokens")),
        );
        for (field, value) in [
            ("inputAudioTokens", &input["audio_tokens"]),
            ("inputImageTokens", &input["image_tokens"]),
            ("outputAudioTokens", &output["audio_tokens"]),
            ("outputImageTokens", &output["image_tokens"]),
            ("reasoningTokens", &output["reasoning_tokens"]),
            (
                "cachedAudioTokens",
                &input["cached_tokens_details"]["audio_tokens"],
            ),
            (
                "cachedImageTokens",
                &input["cached_tokens_details"]["image_tokens"],
            ),
        ] {
            put(field, number(value));
        }
        put("audioSeconds", n("seconds").or(n("audio_seconds")));
        put("characters", n("characters").or(n("characterCost")));
    }
    put(
        "totalTokens",
        n("total_tokens")
            .or(n("totalTokenCount"))
            .or(n("totalTokens")),
    );
    if provider == "openrouter" {
        put("costUsd", n("cost"));
    }
    Usage { counts }
}

/// One HTTP operation can contain multiple cumulative usage updates. Emit the
/// latest merged report once, including on stream failure or future cancellation.
pub(crate) struct UsageReport {
    pub handler: Option<UsageHandler>,
    pub event: UsageEvent,
    reported: bool,
}
impl UsageReport {
    pub fn new(
        handler: Option<UsageHandler>,
        provider: &str,
        model: &str,
        operation: &str,
    ) -> Self {
        Self {
            handler,
            event: UsageEvent::new(provider, model, operation, serde_json::json!({})),
            reported: false,
        }
    }
    pub fn update(&mut self, raw: &Value) {
        if let Some(fields) = raw.as_object() {
            self.reported = true;
            self.event
                .raw_usage
                .as_object_mut()
                .unwrap()
                .extend(fields.clone());
        }
    }
    pub fn observe(&mut self, value: &Value) {
        if self.handler.is_none() {
            return;
        }
        let response = value
            .get("response")
            .or(value.get("message"))
            .unwrap_or(value);
        if let Some(model) = response["model"]
            .as_str()
            .or(value["modelVersion"].as_str())
            .or(value["model"].as_str())
        {
            self.event.model = model.trim_start_matches("models/").into();
        }
        if let Some(id) = response["id"].as_str().or(value["responseId"].as_str()) {
            self.event.request_id = Some(id.into());
        }
        if let Some(raw) = value
            .get("usageMetadata")
            .or(response.get("usage"))
            .or(value.get("usage"))
            .or(value["delta"].get("usage"))
        {
            self.update(raw);
        }
        if self.event.provider == "ollama" && value["done"] == true {
            let mut raw = serde_json::Map::new();
            for key in [
                "prompt_eval_count",
                "eval_count",
                "total_duration",
                "load_duration",
                "prompt_eval_duration",
                "eval_duration",
            ] {
                if let Some(value) = value.get(key) {
                    raw.insert(key.into(), value.clone());
                }
            }
            self.update(&Value::Object(raw));
        }
    }
}
impl Drop for UsageReport {
    fn drop(&mut self) {
        if self.reported {
            self.event.usage = normalize_usage(&self.event.provider, &self.event.raw_usage);
            emit_usage(&self.handler, self.event.clone());
        }
    }
}
