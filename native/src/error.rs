use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("request cancelled")]
    Cancelled,
    #[error("HTTP {status}: {body}")]
    Http { status: u16, body: String },
    #[error("transport failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("unsupported feature: {0}")]
    Unsupported(String),
    #[error("provider protocol error: {0}")]
    Protocol(String),
    #[error("schema validation failed: {0}")]
    Schema(String),
    #[error("agent reached its {0}-iteration limit")]
    IterationLimit(usize),
    #[error("tool failed: {0}")]
    Tool(String),
    #[error("context compression failed: {0}")]
    Compression(String),
}

pub(crate) fn check_cancel(token: &crate::CancellationToken) -> Result<()> {
    if token.is_cancelled() {
        Err(Error::Cancelled)
    } else {
        Ok(())
    }
}
