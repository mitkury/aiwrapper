#![allow(dead_code)]
use aiwrapper::*;
use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
};
type RecordedRequest = (String, Value, BTreeMap<String, String>);
pub struct Fixture {
    pub requests: Mutex<Vec<RecordedRequest>>,
    responses: Mutex<VecDeque<(u16, Vec<Vec<u8>>)>>,
}
impl Fixture {
    pub fn new(responses: Vec<(u16, String)>) -> Arc<Self> {
        Arc::new(Self {
            requests: Mutex::new(vec![]),
            responses: Mutex::new(
                responses
                    .into_iter()
                    .map(|(s, b)| (s, b.as_bytes().chunks(1).map(|c| c.to_vec()).collect()))
                    .collect(),
            ),
        })
    }
    pub fn lang(self: &Arc<Self>, provider: Provider) -> Lang {
        Lang::with_transport(
            ProviderConfig::new(provider, "test-model").with_api_key("test-key"),
            self.clone(),
        )
        .unwrap()
    }
}
#[async_trait]
impl HttpTransport for Fixture {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse> {
        let body = serde_json::from_slice(&request.body).unwrap_or(json!("binary"));
        self.requests
            .lock()
            .unwrap()
            .push((request.url, body, request.headers));
        let (status, chunks) = self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected request");
        Ok(HttpResponse {
            status,
            headers: BTreeMap::new(),
            body: futures_util::stream::iter(chunks.into_iter().map(Ok)).boxed(),
        })
    }
}
pub fn sse(values: Vec<Value>) -> String {
    values
        .iter()
        .map(|v| format!("data: {v}\r\n\r\n"))
        .collect()
}
pub fn chat(text: &str) -> String {
    sse(vec![
        json!({"choices":[{"delta":{"content":text}}]}),
        json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
    ]) + "data: [DONE]\n\n"
}
pub fn tool() -> Message {
    Message::new(
        Role::Assistant,
        vec![Item::Tool {
            call_id: "call1".into(),
            name: "add".into(),
            arguments: json!({"a":2,"b":3}),
            thought_signature: None,
        }],
    )
}
