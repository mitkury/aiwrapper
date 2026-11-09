use crate::{CancellationToken, Error, HttpResponse, Result};
use futures_util::StreamExt;
use serde_json::Value;

const MAX_EVENT_BYTES: usize = 8 * 1024 * 1024;

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
        // Scan each byte once, retaining only the unfinished line across chunks.
        // A transport chunk may contain many events and has no protocol size limit.
        for part in chunk?.split_inclusive(|b| *b == b'\n') {
            crate::error::check_cancel(cancellation)?;
            if buffer.len() + data.len() + part.len() > MAX_EVENT_BYTES {
                return Err(Error::Protocol("stream event exceeds 8 MiB".into()));
            }
            buffer.extend_from_slice(part);
            if part.last() != Some(&b'\n') {
                continue;
            }
            let line = std::str::from_utf8(&buffer)
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
                        return crate::error::check_cancel(cancellation);
                    } else {
                        on_value(serde_json::from_str(event)?)?;
                    }
                    data.clear();
                }
            } else if let Some(value) = line.strip_prefix("data:") {
                data.push_str(value.strip_prefix(' ').unwrap_or(value));
                data.push('\n');
            }
            buffer.clear();
        }
    }
    crate::error::check_cancel(cancellation)?;
    if ndjson && !buffer.iter().all(u8::is_ascii_whitespace) {
        on_value(serde_json::from_slice(&buffer)?)?;
    } else if !ndjson && (!buffer.is_empty() || !data.is_empty()) {
        return Err(Error::Protocol("stream ended inside an event".into()));
    }
    crate::error::check_cancel(cancellation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream;
    use std::{collections::BTreeMap, time::Duration};

    fn response(chunks: Vec<Vec<u8>>) -> HttpResponse {
        HttpResponse {
            status: 200,
            headers: BTreeMap::new(),
            body: stream::iter(chunks.into_iter().map(Ok)).boxed(),
        }
    }

    #[tokio::test]
    async fn framing_does_not_depend_on_network_chunk_boundaries() {
        let bytes = "data: {\r\ndata: \"text\":\"你好\"}\r\n\r\ndata: [DONE]\n\n".as_bytes();
        for chunk_size in [1, 2, 7, bytes.len()] {
            let mut values = vec![];
            read(
                response(bytes.chunks(chunk_size).map(<[u8]>::to_vec).collect()),
                false,
                &CancellationToken::new(),
                &mut |value| {
                    values.push(value);
                    Ok(())
                },
            )
            .await
            .unwrap();
            assert_eq!(
                values,
                vec![
                    serde_json::json!({"text":"你好"}),
                    serde_json::json!({"__done":true})
                ]
            );
        }
    }

    #[tokio::test]
    async fn limit_applies_to_each_event_not_the_transport_chunk() {
        let event = format!("data: \"{}\"\n\n", "x".repeat(1024 * 1024));
        let mut count = 0;
        read(
            response(vec![event.repeat(9).into_bytes()]),
            false,
            &CancellationToken::new(),
            &mut |_| {
                count += 1;
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(count, 9);
    }

    #[tokio::test]
    async fn oversized_multiline_events_and_unterminated_lines_are_bounded() {
        let line = format!("data: \"{}\"\n", "x".repeat(1024 * 1024)).into_bytes();
        for chunks in [vec![line; 9], vec![vec![b'x'; MAX_EVENT_BYTES + 1]]] {
            let error = read(
                response(chunks),
                false,
                &CancellationToken::new(),
                &mut |_| panic!("oversized event was emitted"),
            )
            .await
            .unwrap_err();
            assert!(matches!(error, Error::Protocol(message) if message.contains("exceeds 8 MiB")));
        }
    }

    #[tokio::test]
    async fn done_does_not_wait_for_transport_eof() {
        let mut response = response(vec![b"data: [DONE]\n\n".to_vec()]);
        response.body = response.body.chain(stream::pending()).boxed();
        tokio::time::timeout(
            Duration::from_secs(1),
            read(response, false, &CancellationToken::new(), &mut |_| Ok(())),
        )
        .await
        .expect("waited for EOF after [DONE]")
        .unwrap();
    }

    #[tokio::test]
    async fn cancellation_stops_other_events_in_the_same_chunk_and_at_ndjson_eof() {
        for (ndjson, bytes) in [
            (false, b"data: {}\n\ndata: {}\n\n".to_vec()),
            (true, b"{}".to_vec()),
        ] {
            let cancel = CancellationToken::new();
            let mut count = 0;
            let result = read(response(vec![bytes]), ndjson, &cancel, &mut |_| {
                count += 1;
                cancel.cancel();
                Ok(())
            })
            .await;
            assert!(matches!(result, Err(Error::Cancelled)));
            assert_eq!(count, 1);
        }
    }

    #[tokio::test]
    async fn truncated_sse_is_rejected_while_ndjson_can_end_without_a_newline() {
        for bytes in [b"data: {}".to_vec(), b"data: {}\n".to_vec()] {
            assert!(
                read(
                    response(vec![bytes]),
                    false,
                    &CancellationToken::new(),
                    &mut |_| Ok(())
                )
                .await
                .is_err()
            );
        }
        let mut values = vec![];
        read(
            response(vec![b"{}\n{}".to_vec()]),
            true,
            &CancellationToken::new(),
            &mut |value| {
                values.push(value);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(values.len(), 2);
    }
}
