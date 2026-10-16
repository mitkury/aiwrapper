use super::*;
use crate::{Item, Role, messages::image_url};

pub(super) fn build(
    config: &ProviderConfig,
    conversation: &Conversation,
    options: &ChatOptions,
) -> Result<(String, Value)> {
    let p = config.provider;
    let mut body = json!({"model":config.model, "stream":true});
    let path = match p {
        Provider::Openai => {
            let mut input = vec![];
            for message in &conversation.messages {
                if let Some(raw) = message
                    .meta
                    .as_ref()
                    .and_then(|m| m.get("openaiOutput"))
                    .and_then(Value::as_array)
                {
                    input.extend(raw.iter().cloned());
                    continue;
                }
                let mut content = vec![];
                for item in &message.items {
                    match item {
                        Item::Text { text } => content.push(json!({"type":if message.role == Role::Assistant {"output_text"} else {"input_text"},"text":text})),
                        Item::Image { url, base64, mime_type } => content.push(json!({"type":"input_image","image_url":image_url(url,base64,mime_type)?})),
                        Item::Tool { call_id,name,arguments,.. } => input.push(json!({"type":"function_call","call_id":call_id,"name":name,"arguments":arguments.to_string()})),
                        Item::ToolResult { call_id,result,.. } => input.push(json!({"type":"function_call_output","call_id":call_id,"output":response_tool_output(result)?})),
                        Item::Reasoning { .. } => {}
                    }
                }
                if !content.is_empty() {
                    input.push(json!({"role":role(message.role),"content":content}));
                }
            }
            body["input"] = json!(input);
            body["store"] = json!(false);
            body["include"] = json!(["reasoning.encrypted_content"]);
            if !conversation.instructions.is_empty() {
                body["instructions"] = json!(conversation.instructions);
            }
            let mut tools: Vec<Value> = options.tool_definitions().iter().map(|t| json!({"type":"function","name":t.name,"description":t.description,"parameters":t.parameters,"strict":false})).collect();
            tools.extend(options.built_in_tools.clone());
            if !tools.is_empty() {
                body["tools"] = json!(tools);
            }
            if let Some(schema) = &options.schema {
                body["text"] = json!({"format":{"type":"json_schema","name":"response","schema":schema,"strict":true}});
            }
            if let Some(max) = options.max_tokens {
                body["max_output_tokens"] = json!(max);
            }
            "/responses".into()
        }
        Provider::Anthropic => {
            body["messages"] = json!(anthropic_messages(conversation)?);
            body["max_tokens"] = json!(options.max_tokens.unwrap_or(4096));
            let instructions = conversation.instructions.clone();
            if let Some(schema) = &options.schema {
                body["output_config"] = json!({"format":{"type":"json_schema","schema":schema}});
            }
            if !instructions.is_empty() {
                body["system"] = json!(instructions);
            }
            let mut tools: Vec<Value> = options.tool_definitions().iter().map(|t| json!({"name":t.name,"description":t.description,"input_schema":t.parameters})).collect();
            tools.extend(options.built_in_tools.clone());
            if !tools.is_empty() {
                body["tools"] = json!(tools);
            }
            "/messages".into()
        }
        Provider::Google => {
            body = json!({"contents":google_messages(conversation)?});
            if !conversation.instructions.is_empty() {
                body["systemInstruction"] = json!({"parts":[{"text":conversation.instructions}]});
            }
            let mut generation = json!({});
            if let Some(max) = options.max_tokens {
                generation["maxOutputTokens"] = json!(max);
            }
            if let Some(schema) = &options.schema {
                generation["responseMimeType"] = json!("application/json");
                generation["responseJsonSchema"] = schema.clone();
            }
            body["generationConfig"] = generation;
            let mut tools = options.built_in_tools.clone();
            if !options.tool_definitions().is_empty() {
                tools.push(json!({"functionDeclarations":options.tool_definitions().iter().map(|t| json!({"name":t.name,"description":t.description,"parametersJsonSchema":t.parameters})).collect::<Vec<_>>()}));
            }
            if !tools.is_empty() {
                body["tools"] = json!(tools);
            }
            // Escape slashes, colons and query characters in the model path component.
            let model: String = config
                .model
                .trim_start_matches("models/")
                .bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() || b"-_.".contains(&b) {
                        (b as char).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect();
            format!("/models/{model}:streamGenerateContent?alt=sse")
        }
        Provider::Ollama => {
            reject_builtins(options)?;
            let mut messages = vec![];
            if !conversation.instructions.is_empty() {
                messages.push(json!({"role":"system","content":conversation.instructions}));
            }
            for m in &conversation.messages {
                if m.role == Role::ToolResults {
                    for item in &m.items {
                        if let Item::ToolResult { name, result, .. } = item {
                            messages.push(json!({"role":"tool","tool_name":name,"content":plain_tool_output(result)?}));
                        }
                    }
                    continue;
                }
                let mut value = json!({"role":role(m.role),"content":m.answer()});
                let mut images = vec![];
                let mut calls = vec![];
                for item in &m.items {
                    match item {
                        Item::Image {
                            url,
                            base64,
                            mime_type,
                        } => images.push(inline_image(url, base64, mime_type)?.1),
                        Item::Tool {
                            name, arguments, ..
                        } => calls.push(json!({"function":{"name":name,"arguments":arguments}})),
                        _ => {}
                    }
                }
                if !images.is_empty() {
                    value["images"] = json!(images);
                }
                if !calls.is_empty() {
                    value["tool_calls"] = json!(calls);
                }
                messages.push(value);
            }
            body["messages"] = json!(messages);
            add_chat_tools(&mut body, options);
            if let Some(max) = options.max_tokens {
                body["options"] = json!({"num_predict":max});
            }
            if let Some(schema) = &options.schema {
                body["format"] = schema.clone();
            }
            "/api/chat".into()
        }
        _ => {
            reject_builtins(options)?;
            body["messages"] = json!(chat_messages(conversation)?);
            add_chat_tools(&mut body, options);
            if let Some(max) = options.max_tokens {
                body["max_tokens"] = json!(max);
            }
            if let Some(schema) = &options.schema {
                body["response_format"] = if p == Provider::Cohere {
                    json!({"type":"json_object","schema":schema})
                } else {
                    json!({"type":"json_schema","json_schema":{"name":"response","schema":schema,"strict":true}})
                };
            }
            if p == Provider::Cohere {
                "/chat".into()
            } else {
                "/chat/completions".into()
            }
        }
    };
    for (key, value) in config.body.iter().chain(&options.body) {
        body[key] = value.clone();
    }
    // Streaming is required by this decoder. Reject overrides instead of silently misreading JSON.
    if p != Provider::Google && body.get("stream") != Some(&json!(true)) {
        return Err(Error::Invalid("stream must remain true".into()));
    }
    Ok((path, body))
}

fn role(role: Role) -> &'static str {
    match role {
        Role::Assistant => "assistant",
        Role::User => "user",
        Role::ToolResults => "tool",
    }
}
fn reject_builtins(options: &ChatOptions) -> Result<()> {
    if !options.built_in_tools.is_empty() {
        return Err(Error::Unsupported(
            "built-in tools for this provider".into(),
        ));
    }
    Ok(())
}
fn add_chat_tools(body: &mut Value, options: &ChatOptions) {
    if !options.tool_definitions().is_empty() {
        body["tools"] = json!(
            options
                .tool_definitions()
                .iter()
                .map(|t| json!({"type":"function","function":t}))
                .collect::<Vec<_>>()
        );
    }
}
pub(super) fn inline_image(
    url: &Option<String>,
    base64: &Option<String>,
    mime: &Option<String>,
) -> Result<(String, String)> {
    if let (None, Some(data)) = (url, base64) {
        return Ok((
            mime.clone().unwrap_or_else(|| "image/png".into()),
            data.clone(),
        ));
    }
    if let (Some(url), None) = (url, base64)
        && let Some(data) = url.strip_prefix("data:")
        && let Some((mime, data)) = data.split_once(";base64,")
    {
        return Ok((mime.into(), data.into()));
    }
    Err(Error::Unsupported(
        "this provider requires base64 image bytes, not a remote URL".into(),
    ))
}
fn parts(result: &Value) -> Option<&Vec<Value>> {
    if result["type"] == "tool-content" {
        result["content"].as_array()
    } else {
        None
    }
}
fn plain_tool_output(result: &Value) -> Result<String> {
    if let Some(parts) = parts(result) {
        if parts.iter().any(|p| p["type"] != "text") {
            return Err(Error::Unsupported(
                "image tool results for this provider".into(),
            ));
        }
        return Ok(parts
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"));
    }
    Ok(output_text(result))
}
fn part_image(part: &Value) -> Result<(Option<String>, Option<String>, Option<String>)> {
    let url = part["url"].as_str().map(str::to_owned);
    let base64 = part["base64"].as_str().map(str::to_owned);
    let mime = part["mimeType"].as_str().map(str::to_owned);
    image_url(&url, &base64, &mime)?;
    Ok((url, base64, mime))
}
fn response_tool_output(result: &Value) -> Result<Value> {
    match parts(result) {
        None => Ok(json!(output_text(result))),
        Some(parts) => Ok(json!(
            parts
                .iter()
                .map(|p| {
                    if p["type"] == "text" {
                        return Ok(json!({"type":"input_text","text":p["text"]}));
                    }
                    let (url, data, mime) = part_image(p)?;
                    Ok(json!({"type":"input_image","image_url":image_url(&url,&data,&mime)?}))
                })
                .collect::<Result<Vec<_>>>()?
        )),
    }
}
fn chat_messages(conversation: &Conversation) -> Result<Vec<Value>> {
    let mut out = vec![];
    if !conversation.instructions.is_empty() {
        out.push(json!({"role":"system","content":conversation.instructions}));
    }
    for m in &conversation.messages {
        if m.role == Role::ToolResults {
            for item in &m.items {
                if let Item::ToolResult {
                    call_id, result, ..
                } = item
                {
                    out.push(json!({"role":"tool","tool_call_id":call_id,"content":plain_tool_output(result)?}));
                }
            }
            continue;
        }
        let mut content = vec![];
        let mut calls = vec![];
        for item in &m.items {
            match item {
                Item::Text { text } => content.push(json!({"type":"text","text":text})),
                Item::Image { url,base64,mime_type } => content.push(json!({"type":"image_url","image_url":{"url":image_url(url,base64,mime_type)?}})),
                Item::Tool { call_id,name,arguments,.. } => calls.push(json!({"id":call_id,"type":"function","function":{"name":name,"arguments":arguments.to_string()}})),
                _ => {}
            }
        }
        let mut value = json!({"role":role(m.role),"content":content});
        if content.is_empty() {
            value["content"] = Value::Null;
        }
        if !calls.is_empty() {
            value["tool_calls"] = json!(calls);
        }
        out.push(value);
    }
    Ok(out)
}
fn anthropic_image(
    url: &Option<String>,
    base64: &Option<String>,
    mime: &Option<String>,
) -> Result<Value> {
    let source = if let Some(url) = url.as_ref().filter(|u| !u.starts_with("data:")) {
        json!({"type":"url","url":url})
    } else {
        let (mime, data) = inline_image(url, base64, mime)?;
        json!({"type":"base64","media_type":mime,"data":data})
    };
    Ok(json!({"type":"image","source":source}))
}
fn anthropic_messages(conversation: &Conversation) -> Result<Vec<Value>> {
    let mut out = vec![];
    for m in &conversation.messages {
        if let Some(blocks) = m.meta.as_ref().and_then(|m| m.get("anthropicContent")) {
            out.push(json!({"role":"assistant","content":blocks}));
            continue;
        }
        let mut content = vec![];
        for item in &m.items {
            match item {
                Item::Text { text } => content.push(json!({"type":"text","text":text})),
                Item::Image {
                    url,
                    base64,
                    mime_type,
                } => content.push(anthropic_image(url, base64, mime_type)?),
                Item::Tool {
                    call_id,
                    name,
                    arguments,
                    ..
                } => content
                    .push(json!({"type":"tool_use","id":call_id,"name":name,"input":arguments})),
                Item::ToolResult {
                    call_id, result, ..
                } => {
                    let result_content = match parts(result) {
                        None => json!(output_text(result)),
                        Some(parts) => json!(
                            parts
                                .iter()
                                .map(|p| {
                                    if p["type"] == "text" {
                                        return Ok(p.clone());
                                    }
                                    let (url, data, mime) = part_image(p)?;
                                    anthropic_image(&url, &data, &mime)
                                })
                                .collect::<Result<Vec<_>>>()?
                        ),
                    };
                    content.push(json!({"type":"tool_result","tool_use_id":call_id,"content":result_content,"is_error":result.get("error").is_some()}));
                }
                _ => {}
            }
        }
        out.push(json!({"role":if m.role == Role::Assistant {"assistant"} else {"user"},"content":content}));
    }
    Ok(out)
}
fn google_messages(conversation: &Conversation) -> Result<Vec<Value>> {
    let mut out = vec![];
    for m in &conversation.messages {
        if let Some(parts) = m.meta.as_ref().and_then(|m| m.get("googleParts")) {
            out.push(json!({"role":"model","parts":parts}));
            continue;
        }
        let mut content = vec![];
        for item in &m.items {
            match item {
                Item::Text { text } => content.push(json!({"text":text})),
                Item::Image {
                    url,
                    base64,
                    mime_type,
                } => {
                    let (mime, data) = inline_image(url, base64, mime_type)?;
                    content.push(json!({"inlineData":{"mimeType":mime,"data":data}}));
                }
                Item::Tool {
                    call_id,
                    name,
                    arguments,
                    thought_signature,
                } => {
                    let mut part =
                        json!({"functionCall":{"id":call_id,"name":name,"args":arguments}});
                    if let Some(signature) = thought_signature {
                        part["thoughtSignature"] = json!(signature);
                    }
                    content.push(part);
                }
                Item::ToolResult {
                    call_id,
                    name,
                    result,
                } => {
                    let mut response = json!({"id":call_id,"name":name,"response":if result.is_object() {result.clone()} else {json!({"result":result})}});
                    if let Some(parts) = parts(result) {
                        let mut texts = vec![];
                        let mut images = vec![];
                        for part in parts {
                            if part["type"] == "text" {
                                texts.push(part["text"].clone());
                            } else {
                                let (url, data, mime) = part_image(part)?;
                                let (mime, data) = inline_image(&url, &data, &mime)?;
                                images.push(json!({"inlineData":{"mimeType":mime,"data":data}}));
                            }
                        }
                        response["response"] = json!({"result":texts});
                        if !images.is_empty() {
                            response["parts"] = json!(images);
                        }
                    }
                    content.push(json!({"functionResponse":response}));
                }
                _ => {}
            }
        }
        out.push(
            json!({"role":if m.role == Role::Assistant {"model"} else {"user"},"parts":content}),
        );
    }
    Ok(out)
}
