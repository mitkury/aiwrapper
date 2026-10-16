use super::*;
use crate::{Item, Role};
use std::sync::atomic::{AtomicU64, Ordering};

static TURN_ID: AtomicU64 = AtomicU64::new(1);

pub(super) struct Decoder {
    provider: Provider,
    message: Message,
    done: bool,
    calls: BTreeMap<usize, Value>,
    blocks: BTreeMap<usize, Value>,
    arguments: BTreeMap<usize, String>,
    google_parts: Vec<Value>,
    turn: u64,
}

impl Decoder {
    pub fn new(provider: Provider) -> Self {
        Self {
            provider,
            message: Message::new(Role::Assistant, vec![]),
            done: false,
            calls: BTreeMap::new(),
            blocks: BTreeMap::new(),
            arguments: BTreeMap::new(),
            google_parts: vec![],
            turn: TURN_ID.fetch_add(1, Ordering::Relaxed),
        }
    }
    pub fn push(
        &mut self,
        value: Value,
        update: &mut (dyn for<'m> FnMut(&'m Message) + Send),
    ) -> Result<()> {
        if let Some(error) = value.get("error") {
            return Err(Error::Protocol(error.to_string()));
        }
        if value["type"] == "error" {
            return Err(Error::Protocol(value.to_string()));
        }
        match self.provider {
            Provider::Openai => self.responses(&value)?,
            Provider::Anthropic => self.anthropic(&value)?,
            Provider::Google => self.google(&value)?,
            Provider::Ollama => self.ollama(&value)?,
            Provider::Cohere => self.cohere(&value)?,
            _ => self.chat(&value)?,
        }
        if !self.message.items.is_empty() {
            update(&self.message);
        }
        Ok(())
    }
    pub fn finish(mut self) -> Result<Message> {
        if !self.done {
            return Err(Error::Protocol(
                "stream ended before the provider completed its response".into(),
            ));
        }
        for (index, call) in &self.calls {
            let raw = self
                .arguments
                .get(index)
                .map(String::as_str)
                .unwrap_or("{}");
            let arguments: Value = if raw.trim().is_empty() {
                json!({})
            } else {
                serde_json::from_str(raw)?
            };
            if !arguments.is_object() {
                return Err(Error::Protocol("tool arguments must be an object".into()));
            }
            let name = call["name"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| Error::Protocol("tool name missing".into()))?;
            let call_id = call["id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("native-{}-{index}", self.turn));
            self.message.items.push(Item::Tool {
                call_id,
                name: name.into(),
                arguments,
                thought_signature: None,
            });
        }
        for item in &self.message.items {
            if let Item::Tool {
                call_id,
                name,
                arguments,
                ..
            } = item
                && (call_id.is_empty() || name.is_empty() || !arguments.is_object())
            {
                return Err(Error::Protocol("malformed tool call".into()));
            }
        }
        if self.message.items.is_empty() {
            return Err(Error::Protocol(
                "provider returned no supported output".into(),
            ));
        }
        Ok(self.message)
    }
    fn text(&mut self, text: &str, reasoning: bool) {
        if text.is_empty() {
            return;
        }
        match (self.message.items.last_mut(), reasoning) {
            (Some(Item::Text { text: existing }), false)
            | (Some(Item::Reasoning { text: existing }), true) => existing.push_str(text),
            (_, false) => self.message.items.push(Item::Text { text: text.into() }),
            (_, true) => self
                .message
                .items
                .push(Item::Reasoning { text: text.into() }),
        }
    }
    fn meta(&mut self, key: &str, value: Value) {
        self.message.meta.get_or_insert_with(|| json!({}))[key] = value;
    }
    fn chat(&mut self, value: &Value) -> Result<()> {
        if value["__done"] == true {
            self.done = true;
            return Ok(());
        }
        if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
            self.meta("usage", usage.clone());
        }
        let choice = &value["choices"][0];
        if let Some(reason) = choice["finish_reason"].as_str() {
            if !matches!(reason, "stop" | "tool_calls" | "function_call") {
                return Err(Error::Protocol(format!("generation stopped: {reason}")));
            }
            self.done = true;
        }
        let delta = &choice["delta"];
        if let Some(text) = delta["content"].as_str() {
            self.text(text, false);
        }
        if let Some(text) = delta["reasoning_content"]
            .as_str()
            .or(delta["reasoning"].as_str())
        {
            self.text(text, true);
        }
        if let Some(refusal) = delta["refusal"].as_str() {
            return Err(Error::Protocol(format!("model refused: {refusal}")));
        }
        if let Some(calls) = delta["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"].as_u64().unwrap_or(0) as usize;
                let entry = self.calls.entry(index).or_insert_with(|| json!({}));
                if let Some(id) = call.get("id") {
                    entry["id"] = id.clone();
                }
                if let Some(name) = call["function"].get("name") {
                    entry["name"] = name.clone();
                }
                if let Some(args) = call["function"]["arguments"].as_str() {
                    self.arguments.entry(index).or_default().push_str(args);
                }
            }
        }
        Ok(())
    }
    fn responses(&mut self, value: &Value) -> Result<()> {
        match value["type"].as_str().unwrap_or("") {
            "response.output_text.delta" => self.text(value["delta"].as_str().unwrap_or(""), false),
            "response.reasoning_summary_text.delta" => {
                self.text(value["delta"].as_str().unwrap_or(""), true)
            }
            "response.refusal.delta" => {
                return Err(Error::Protocol(format!(
                    "model refused: {}",
                    value["delta"]
                )));
            }
            "response.failed" | "response.incomplete" => {
                return Err(Error::Protocol(value["response"].to_string()));
            }
            "response.completed" => {
                let response = &value["response"];
                if response["status"]
                    .as_str()
                    .is_some_and(|s| s != "completed")
                {
                    return Err(Error::Protocol(response.to_string()));
                }
                let output = response["output"]
                    .as_array()
                    .ok_or_else(|| Error::Protocol("Responses output missing".into()))?;
                self.message.items.clear();
                for item in output {
                    match item["type"].as_str().unwrap_or("") {
                        "message" => {
                            if let Some(parts) = item["content"].as_array() {
                                for part in parts {
                                    if part["type"] == "refusal" {
                                        return Err(Error::Protocol(format!(
                                            "model refused: {}",
                                            part["refusal"]
                                        )));
                                    }
                                    if let Some(text) = part["text"].as_str() {
                                        self.text(text, false);
                                    }
                                }
                            }
                        }
                        "reasoning" => {
                            if let Some(summary) = item["summary"].as_array() {
                                for part in summary {
                                    if let Some(text) = part["text"].as_str() {
                                        self.text(text, true);
                                    }
                                }
                            }
                        }
                        "function_call" => self.message.items.push(Item::Tool {
                            call_id: required(item, "call_id")?,
                            name: required(item, "name")?,
                            arguments: serde_json::from_str(
                                item["arguments"].as_str().unwrap_or("{}"),
                            )?,
                            thought_signature: None,
                        }),
                        "image_generation_call" => {
                            if let Some(data) = item["result"].as_str() {
                                self.message.items.push(Item::Image {
                                    url: None,
                                    base64: Some(data.into()),
                                    mime_type: Some("image/png".into()),
                                });
                            }
                        }
                        _ => {}
                    }
                }
                self.meta("openaiOutput", json!(output));
                self.meta("usage", response["usage"].clone());
                self.done = true;
            }
            _ => {}
        }
        Ok(())
    }
    fn anthropic(&mut self, value: &Value) -> Result<()> {
        let index = value["index"].as_u64().unwrap_or(0) as usize;
        match value["type"].as_str().unwrap_or("") {
            "message_start" => self.meta("usage", value["message"]["usage"].clone()),
            "content_block_start" => {
                self.blocks.insert(index, value["content_block"].clone());
            }
            "content_block_delta" => {
                let delta = &value["delta"];
                let block = self.blocks.entry(index).or_insert_with(|| json!({}));
                let (key, field) = match delta["type"].as_str().unwrap_or("") {
                    "text_delta" => ("text", "text"),
                    "thinking_delta" => ("thinking", "thinking"),
                    "signature_delta" => ("signature", "signature"),
                    "input_json_delta" => {
                        self.arguments
                            .entry(index)
                            .or_default()
                            .push_str(delta["partial_json"].as_str().unwrap_or(""));
                        return Ok(());
                    }
                    _ => return Ok(()),
                };
                let mut text = block[key].as_str().unwrap_or("").to_owned();
                text.push_str(delta[field].as_str().unwrap_or(""));
                block[key] = json!(text);
            }
            "content_block_stop" => {
                if let Some(raw) = self.arguments.remove(&index) {
                    self.blocks.entry(index).or_insert_with(|| json!({}))["input"] =
                        serde_json::from_str(&raw)?;
                }
            }
            "message_delta" => {
                if let Some(reason) = value["delta"]["stop_reason"].as_str()
                    && !matches!(reason, "end_turn" | "tool_use" | "stop_sequence")
                {
                    return Err(Error::Protocol(format!("generation stopped: {reason}")));
                }
                if let Some(usage) = value.get("usage") {
                    self.meta("outputUsage", usage.clone());
                }
            }
            "message_stop" => {
                self.done = true;
            }
            _ => {}
        }
        self.message.items.clear();
        for block in self.blocks.values() {
            match block["type"].as_str().unwrap_or("") {
                "text" => self.message.items.push(Item::Text {
                    text: block["text"].as_str().unwrap_or("").into(),
                }),
                "thinking" => self.message.items.push(Item::Reasoning {
                    text: block["thinking"].as_str().unwrap_or("").into(),
                }),
                "tool_use" if self.done => self.message.items.push(Item::Tool {
                    call_id: required(block, "id")?,
                    name: required(block, "name")?,
                    arguments: block["input"].clone(),
                    thought_signature: None,
                }),
                _ => {}
            }
        }
        if self.done {
            self.meta(
                "anthropicContent",
                json!(self.blocks.values().collect::<Vec<_>>()),
            );
        }
        Ok(())
    }
    fn google(&mut self, value: &Value) -> Result<()> {
        if let Some(reason) = value["promptFeedback"]["blockReason"].as_str() {
            return Err(Error::Protocol(format!("prompt blocked: {reason}")));
        }
        let candidate = &value["candidates"][0];
        if let Some(parts) = candidate["content"]["parts"].as_array() {
            for part in parts {
                self.google_parts.push(part.clone());
                if let Some(text) = part["text"].as_str() {
                    self.text(text, part["thought"] == true);
                }
                if let Some(call) = part.get("functionCall") {
                    let call_id = call["id"].as_str().map(str::to_owned).unwrap_or_else(|| {
                        format!("native-{}-{}", self.turn, self.message.items.len())
                    });
                    // Keep generated ids in the replay data too.
                    self.google_parts.last_mut().unwrap()["functionCall"]["id"] = json!(call_id);
                    self.message.items.push(Item::Tool {
                        call_id,
                        name: required(call, "name")?,
                        arguments: call.get("args").cloned().unwrap_or_else(|| json!({})),
                        thought_signature: part["thoughtSignature"].as_str().map(str::to_owned),
                    });
                }
                if let Some(data) = part["inlineData"]["data"].as_str() {
                    self.message.items.push(Item::Image {
                        url: None,
                        base64: Some(data.into()),
                        mime_type: part["inlineData"]["mimeType"].as_str().map(str::to_owned),
                    });
                }
            }
        }
        if let Some(reason) = candidate["finishReason"].as_str() {
            if reason != "STOP" {
                return Err(Error::Protocol(format!("generation stopped: {reason}")));
            }
            self.done = true;
        }
        if let Some(usage) = value.get("usageMetadata") {
            self.meta("usage", usage.clone());
        }
        self.meta("googleParts", json!(self.google_parts));
        Ok(())
    }
    fn ollama(&mut self, value: &Value) -> Result<()> {
        let message = &value["message"];
        if let Some(text) = message["content"].as_str() {
            self.text(text, false);
        }
        if let Some(text) = message["thinking"].as_str() {
            self.text(text, true);
        }
        if let Some(calls) = message["tool_calls"].as_array() {
            for call in calls {
                self.message.items.push(Item::Tool {
                    call_id: format!("native-{}-{}", self.turn, self.message.items.len()),
                    name: required(&call["function"], "name")?,
                    arguments: call["function"]["arguments"].clone(),
                    thought_signature: None,
                });
            }
        }
        if value["done"] == true {
            if value["done_reason"] == "length" {
                return Err(Error::Protocol("generation stopped: length".into()));
            }
            self.done = true;
            self.meta("usage",json!({"inputTokens":value["prompt_eval_count"],"outputTokens":value["eval_count"]}));
        }
        Ok(())
    }
    fn cohere(&mut self, value: &Value) -> Result<()> {
        let delta = &value["delta"]["message"];
        let index = value["index"].as_u64().unwrap_or(0) as usize;
        match value["type"].as_str().unwrap_or("") {
            "content-delta" => {
                if let Some(text) = delta["content"]["text"].as_str() {
                    self.text(text, false);
                }
            }
            "tool-call-start" => {
                let call = &delta["tool_calls"];
                self.calls.insert(
                    index,
                    json!({"id":call["id"],"name":call["function"]["name"]}),
                );
                if let Some(args) = call["function"]["arguments"].as_str() {
                    self.arguments.entry(index).or_default().push_str(args);
                }
            }
            "tool-call-delta" => {
                if let Some(args) = delta["tool_calls"]["function"]["arguments"].as_str() {
                    self.arguments.entry(index).or_default().push_str(args);
                }
            }
            "message-end" => {
                let reason = value["delta"]["finish_reason"]
                    .as_str()
                    .unwrap_or("COMPLETE");
                if !matches!(reason, "COMPLETE" | "TOOL_CALL") {
                    return Err(Error::Protocol(format!("generation stopped: {reason}")));
                }
                self.meta("usage", value["delta"]["usage"].clone());
                self.done = true;
            }
            _ => {}
        }
        Ok(())
    }
}
fn required(value: &Value, key: &str) -> Result<String> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| Error::Protocol(format!("missing {key}")))
}
