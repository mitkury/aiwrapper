use crate::{Error, Result};
use async_trait::async_trait;
use futures_util::{StreamExt, stream::BoxStream};
use std::{collections::BTreeMap, time::Duration};

pub struct HttpRequest {
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: BoxStream<'static, Result<Vec<u8>>>,
}

/// The only HTTP integration boundary. Hosts may route requests through their
/// own client, proxy, recorder or test fixture. Dropping the future/stream cancels I/O.
#[async_trait]
pub trait HttpTransport: Send + Sync {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse>;
}

#[derive(Clone)]
pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(180))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
    pub fn with_client(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse> {
        let mut builder = self.client.post(request.url).body(request.body);
        for (key, value) in request.headers {
            builder = builder.header(key, value);
        }
        let response = builder
            .send()
            .await
            .map_err(|e| Error::Transport(e.without_url()))?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
            .collect();
        let body = response
            .bytes_stream()
            .map(|chunk| {
                chunk
                    .map(|b| b.to_vec())
                    .map_err(|e| Error::Transport(e.without_url()))
            })
            .boxed();
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

pub(crate) async fn read_body(mut response: HttpResponse, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.body.next().await {
        let chunk = chunk?;
        if bytes.len() + chunk.len() > limit {
            return Err(Error::Protocol("response exceeded size limit".into()));
        }
        bytes.extend(chunk);
    }
    Ok(bytes)
}
