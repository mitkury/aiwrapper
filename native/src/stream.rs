use crate::{CancellationToken, Error, HttpResponse, Result};
use futures_util::StreamExt;
use serde_json::Value;

/// Decode lines as bytes first: network chunks can split a UTF-8 character.
/// SSE multiline data and CRLF are supported; an unterminated final event is an error.
pub(crate) async fn read(
    mut response: HttpResponse,
    ndjson: bool,
    cancellation: &CancellationToken,
    on_value: &mut (dyn FnMut(Value) -> Result<()> + Send),
) -> Result<()> {
    let mut buffer = Vec::new();
    let mut data = String::new();
    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(Error::Cancelled),
            chunk = response.body.next() => chunk,
        };
        let Some(chunk) = chunk else {
            break;
        };
        buffer.extend(chunk?);
        if buffer.len() + data.len() > 8 * 1024 * 1024 {
            return Err(Error::Protocol("stream event exceeds 8 MiB".into()));
        }
        while let Some(end) = buffer.iter().position(|b| *b == b'\n') {
            crate::error::check_cancel(cancellation)?;
            let bytes: Vec<u8> = buffer.drain(..=end).collect();
            let line = std::str::from_utf8(&bytes)
                .map_err(|_| Error::Protocol("invalid stream UTF-8".into()))?
                .trim_end_matches(['\n', '\r']);
            if ndjson {
                if !line.trim().is_empty() {
                    on_value(serde_json::from_str(line)?)?;
                }
            } else if line.is_empty() {
                if !data.is_empty() {
                    let event = data.trim_end_matches('\n');
                    if event == "[DONE]" {
                        on_value(serde_json::json!({"__done":true}))?;
                    } else {
                        on_value(serde_json::from_str(event)?)?;
                    }
                    data.clear();
                }
            } else if let Some(value) = line.strip_prefix("data:") {
                data.push_str(value.strip_prefix(' ').unwrap_or(value));
                data.push('\n');
            }
        }
    }
    if ndjson && !buffer.is_empty() {
        on_value(serde_json::from_slice(&buffer)?)?;
    } else if !buffer.is_empty() || !data.is_empty() {
        return Err(Error::Protocol("stream ended inside an event".into()));
    }
    Ok(())
}
