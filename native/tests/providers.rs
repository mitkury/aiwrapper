mod common;
use aiwrapper::*;
use common::*;
use serde_json::json;

#[tokio::test]
async fn compatible_aliases_use_injected_transport_and_preserve_split_utf8() {
    for p in [
        Provider::OpenaiCompatible,
        Provider::Groq,
        Provider::Deepseek,
        Provider::Kimi,
        Provider::Xai,
        Provider::Mistral,
        Provider::Openrouter,
    ] {
        let transport = Fixture::new(vec![(200, chat("Olá 🦀"))]);
        let lang = transport.lang(p);
        let mut result = Conversation::new("Hi");
        result.instructions = "Be brief".into();
        let mut updates = vec![];
        lang.chat(&mut result, &ChatOptions::default(), &mut |m| {
            updates.push(m.answer())
        })
        .await
        .unwrap();
        assert_eq!(result.answer(), "Olá 🦀");
        assert!(result.finished);
        assert!(!updates.is_empty());
        let requests = transport.requests.lock().unwrap();
        assert!(requests[0].0.ends_with("/chat/completions"));
        assert_eq!(requests[0].1["messages"][0]["content"], "Be brief");
        assert_eq!(requests[0].2["authorization"], "Bearer test-key");
    }
}
#[tokio::test]
async fn responses_replays_reasoning_tools_and_generated_images() {
    let output = json!([
        {"type":"reasoning","id":"r","summary":[{"type":"summary_text","text":"Think"}],"encrypted_content":"sealed"},
        {"type":"function_call","call_id":"c","name":"add","arguments":"{\"a\":2,\"b\":3}"},
        {"type":"image_generation_call","result":"aW1hZ2U="}
    ]);
    let response = sse(vec![
        json!({"type":"response.completed","response":{"status":"completed","output":output,"usage":{"input_tokens":7}}}),
    ]);
    let transport = Fixture::new(vec![
        (200, response),
        (
            200,
            sse(vec![
                json!({"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Done"}]}]}}),
            ]),
        ),
    ]);
    let lang = transport.lang(Provider::Openai);
    let mut history = lang.ask("Hi", &ChatOptions::default()).await.unwrap();
    assert!(history.messages.last().unwrap().has_tools());
    assert!(matches!(
        history.messages.last().unwrap().items[2],
        Item::Image { .. }
    ));
    history.messages.push(Message::new(
        Role::ToolResults,
        vec![Item::ToolResult {
            call_id: "c".into(),
            name: "add".into(),
            result: json!(5),
        }],
    ));
    lang.chat(&mut history, &ChatOptions::default(), &mut |_| {})
        .await
        .unwrap();
    assert_eq!(history.answer(), "Done");
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests[1].1["input"][1]["encrypted_content"], "sealed");
    assert_eq!(requests[1].1["input"][4]["output"], "5");
}
#[tokio::test]
async fn anthropic_streams_and_replays_signed_thinking() {
    let response = sse(vec![
        json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}),
        json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"c","name":"add","input":{}}}),
        json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"a\":2,\"b\":3}"}}),
        json!({"type":"content_block_stop","index":1}),
        json!({"type":"message_stop"}),
    ]);
    let transport = Fixture::new(vec![(200, response)]);
    let history = transport
        .lang(Provider::Anthropic)
        .ask("Hi", &ChatOptions::default())
        .await
        .unwrap();
    assert_eq!(
        history.messages[1].meta.as_ref().unwrap()["anthropicContent"][0]["signature"],
        "sig"
    );
    assert!(history.messages[1].has_tools());
    assert_eq!(
        transport.requests.lock().unwrap()[0].2["anthropic-version"],
        "2023-06-01"
    );
}
#[tokio::test]
async fn google_preserves_thought_signatures_and_uses_header_auth() {
    let transport = Fixture::new(vec![(
        200,
        sse(vec![
            json!({"candidates":[{"content":{"parts":[{"functionCall":{"name":"add","args":{"a":2,"b":3}},"thoughtSignature":"sig"}]},"finishReason":"STOP"}]}),
        ]),
    )]);
    let history = transport
        .lang(Provider::Google)
        .ask("Hi", &ChatOptions::default())
        .await
        .unwrap();
    assert!(
        matches!(&history.messages[1].items[0],Item::Tool {thought_signature:Some(s),..} if s=="sig")
    );
    let requests = transport.requests.lock().unwrap();
    assert!(!requests[0].0.contains("test-key"));
    assert_eq!(requests[0].2["x-goog-api-key"], "test-key");
}
#[tokio::test]
async fn ollama_and_cohere_use_their_native_streams() {
    let cases = [
        (
            Provider::Ollama,
            format!(
                "{}\n{}\n",
                json!({"message":{"content":"Hello"}}),
                json!({"done":true,"done_reason":"stop"})
            ),
        ),
        (
            Provider::Cohere,
            sse(vec![
                json!({"type":"content-delta","delta":{"message":{"content":{"text":"Hello"}}}}),
                json!({"type":"message-end","delta":{"finish_reason":"COMPLETE"}}),
            ]),
        ),
    ];
    for (provider, body) in cases {
        assert_eq!(
            Fixture::new(vec![(200, body)])
                .lang(provider)
                .ask("Hi", &ChatOptions::default())
                .await
                .unwrap()
                .answer(),
            "Hello"
        );
    }
}
#[tokio::test]
async fn retries_rejected_http_but_never_a_truncated_stream() {
    let transport = Fixture::new(vec![(503, "busy".into()), (200, chat("OK"))]);
    assert_eq!(
        transport
            .lang(Provider::OpenaiCompatible)
            .ask("Hi", &ChatOptions::default())
            .await
            .unwrap()
            .answer(),
        "OK"
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 2);
    let transport = Fixture::new(vec![(
        200,
        sse(vec![json!({"choices":[{"delta":{"content":"partial"}}]})]),
    )]);
    let mut history = Conversation::new("Hi");
    assert!(
        transport
            .lang(Provider::OpenaiCompatible)
            .chat(&mut history, &ChatOptions::default(), &mut |_| {})
            .await
            .is_err()
    );
    assert_eq!(history.answer(), "partial");
    assert!(!history.finished);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}
#[tokio::test]
async fn structured_output_is_validated_and_tool_arguments_are_assembled() {
    let options = ChatOptions {
        schema: Some(
            json!({"type":"object","properties":{"n":{"type":"number"}},"required":["n"]}),
        ),
        ..ChatOptions::default()
    };
    let transport = Fixture::new(vec![
        (200, chat("{\"n\":3}")),
        (200, chat("{\"n\":\"bad\"}")),
    ]);
    let lang = transport.lang(Provider::OpenaiCompatible);
    assert_eq!(
        lang.ask("Hi", &options).await.unwrap().object().unwrap()["n"],
        3
    );
    assert!(matches!(
        lang.ask("Hi", &options).await,
        Err(Error::Schema(_))
    ));
    let transport = Fixture::new(vec![(
        200,
        sse(vec![
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"add","arguments":"{\"a\":"}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"2}"}}]},"finish_reason":"tool_calls"}]}),
        ]),
    )]);
    let history = transport
        .lang(Provider::OpenaiCompatible)
        .ask("Hi", &ChatOptions::default())
        .await
        .unwrap();
    assert!(matches!(&history.messages[1].items[0],Item::Tool {arguments,..} if arguments["a"]==2));
}
#[tokio::test]
async fn malformed_streams_refusals_and_missing_pairs_are_errors() {
    for body in [
        "data: {bad}\n\n".into(),
        "data: {}".into(),
        sse(vec![
            json!({"choices":[{"delta":{},"finish_reason":"length"}]}),
        ]),
        sse(vec![json!({"error":{"message":"bad"}})]),
    ] {
        assert!(
            Fixture::new(vec![(200, body)])
                .lang(Provider::OpenaiCompatible)
                .ask("Hi", &ChatOptions::default())
                .await
                .is_err()
        );
    }
    let mut history = Conversation::default();
    history.messages.push(tool());
    let transport = Fixture::new(vec![]);
    assert!(
        transport
            .lang(Provider::OpenaiCompatible)
            .chat(&mut history, &ChatOptions::default(), &mut |_| {})
            .await
            .is_err()
    );
    assert!(transport.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn cancellation_stops_before_network_and_during_stream_preserving_partial() {
    let transport = Fixture::new(vec![]);
    let options = ChatOptions::default();
    options.cancellation.cancel();
    assert!(matches!(
        transport.lang(Provider::Google).ask("Hi", &options).await,
        Err(Error::Cancelled)
    ));
    let transport = Fixture::new(vec![(200, chat("partial"))]);
    let options = ChatOptions::default();
    let cancel = options.cancellation.clone();
    let mut history = Conversation::new("Hi");
    assert!(matches!(
        transport
            .lang(Provider::OpenaiCompatible)
            .chat(&mut history, &options, &mut |_| cancel.cancel())
            .await,
        Err(Error::Cancelled)
    ));
    assert_eq!(history.answer(), "partial");
    assert!(history.aborted);
}
#[tokio::test]
async fn reqwest_transport_reaches_a_real_loopback_server() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut data = vec![0; 8192];
        let count = stream.read(&mut data).await.unwrap();
        let request = String::from_utf8_lossy(&data[..count]);
        assert!(request.starts_with("POST /v1/chat/completions"));
        let body = chat("Real HTTP");
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
    });
    let lang = Lang::new(
        ProviderConfig::new(Provider::OpenaiCompatible, "test")
            .with_base_url(format!("http://{address}/v1")),
    )
    .unwrap();
    assert_eq!(
        lang.ask("Hi", &ChatOptions::default())
            .await
            .unwrap()
            .answer(),
        "Real HTTP"
    );
    server.await.unwrap();
}

#[tokio::test]
async fn google_uses_json_schema_tool_field_without_dropping_constraints() {
    let transport = Fixture::new(vec![(
        200,
        sse(vec![
            json!({"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}),
        ]),
    )]);
    let options = ChatOptions {
        tools: Some(vec![ToolDefinition {
            name: "add".into(),
            description: "Add".into(),
            parameters: json!({"type":"object","additionalProperties":false}),
        }]),
        ..ChatOptions::default()
    };
    transport
        .lang(Provider::Google)
        .ask("Hi", &options)
        .await
        .unwrap();
    let requests = transport.requests.lock().unwrap();
    let tool = &requests[0].1["tools"][0]["functionDeclarations"][0];
    assert_eq!(tool["parametersJsonSchema"]["additionalProperties"], false);
    assert!(tool.get("parameters").is_none());
}
#[tokio::test]
async fn image_tool_results_are_translated_or_rejected_explicitly() {
    let mut history = Conversation::new("Look");
    history.messages.push(tool());
    history.messages.push(Message::new(
        Role::ToolResults,
        vec![Item::ToolResult {
            call_id: "call1".into(),
            name: "add".into(),
            result: tool_content(vec![
                json!({"type":"image","base64":"aW1hZ2U=","mimeType":"image/png"}),
            ])
            .unwrap(),
        }],
    ));
    for provider in [Provider::OpenaiCompatible, Provider::Ollama] {
        let transport = Fixture::new(vec![]);
        assert!(matches!(
            transport
                .lang(provider)
                .chat(&mut history.clone(), &ChatOptions::default(), &mut |_| {})
                .await,
            Err(Error::Unsupported(_))
        ));
        assert!(transport.requests.lock().unwrap().is_empty());
    }
    let transport = Fixture::new(vec![(
        200,
        sse(vec![
            json!({"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Image seen"}]}]}}),
        ]),
    )]);
    transport
        .lang(Provider::Openai)
        .chat(&mut history, &ChatOptions::default(), &mut |_| {})
        .await
        .unwrap();
    assert_eq!(
        transport.requests.lock().unwrap()[0].1["input"][2]["output"][0]["type"],
        "input_image"
    );
}
#[tokio::test]
async fn sse_multiline_data_is_decoded() {
    let transport=Fixture::new(vec![(200,"data: {\ndata: \"choices\": [{\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]\ndata: }\n\n".into())]);
    assert_eq!(
        transport
            .lang(Provider::OpenaiCompatible)
            .ask("Hi", &ChatOptions::default())
            .await
            .unwrap()
            .answer(),
        "OK"
    );
}

#[tokio::test]
async fn anthropic_uses_native_structured_output_instead_of_prompt_repair() {
    let transport = Fixture::new(vec![(
        200,
        sse(vec![
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":"{\"n\":1}"}}),
            json!({"type":"message_stop"}),
        ]),
    )]);
    let schema = json!({"type":"object","properties":{"n":{"type":"integer"}},"required":["n"],"additionalProperties":false});
    let options = ChatOptions {
        schema: Some(schema.clone()),
        ..ChatOptions::default()
    };
    assert_eq!(
        transport
            .lang(Provider::Anthropic)
            .ask("Return n=1", &options)
            .await
            .unwrap()
            .object()
            .unwrap()["n"],
        1
    );
    assert_eq!(
        transport.requests.lock().unwrap()[0].1["output_config"]["format"]["schema"],
        schema
    );
}
