//! Bounded, deterministic camera context. Selection runs in the Rust session.
use super::LiveImage;
use crate::{Error, Item, Message, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeSet, VecDeque};

const WINDOW_MS: u64 = 300_000;
const BUFFER_BYTES: usize = 32 * 1024 * 1024;
const REQUEST_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CameraContext {
    #[default]
    Latest,
    Recent,
}

/// One host's monotonically increasing sequence and capture clock, in milliseconds.
/// Hosts must use a new session when replacing/resetting the capture clock.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraFrame {
    pub id: u64,
    pub captured_at_ms: u64,
    pub image: LiveImage,
}
impl CameraFrame {
    pub(super) fn validate(&self) -> Result<()> {
        if self.image.data.len() > 2 * 1024 * 1024 {
            return Err(Error::Invalid("camera image exceeds 2 MiB".into()));
        }
        self.image.validate()
    }
}

struct Received {
    frame: CameraFrame,
    received_ms: u64,
    clock: &'static str,
}
pub(super) struct CameraBuffer {
    mode: CameraContext,
    frames: VecDeque<Received>,
    bytes: usize,
    last: Option<(u64, u64, &'static str)>,
    committed: Option<u64>,
    evicted: usize,
}
impl CameraBuffer {
    pub fn new(mode: CameraContext) -> Self {
        Self {
            mode,
            frames: VecDeque::new(),
            bytes: 0,
            last: None,
            committed: None,
            evicted: 0,
        }
    }
    pub fn push(
        &mut self,
        frame: Option<CameraFrame>,
        image: Option<LiveImage>,
        now: u64,
    ) -> Result<Value> {
        let clock = if frame.is_some() {
            "capture"
        } else {
            "receipt"
        };
        let frame = frame.unwrap_or_else(|| CameraFrame {
            id: self.last.map_or(1, |(id, _, _)| id.saturating_add(1)),
            captured_at_ms: now,
            image: image.expect("legacy image"),
        });
        frame.validate()?;
        if self.last.is_some_and(|(id, time, prior_clock)| {
            frame.id <= id || frame.captured_at_ms < time || prior_clock != clock
        }) {
            return Err(Error::Invalid("camera frames require increasing IDs, monotonic timestamps and one clock per session".into()));
        }
        self.last = Some((frame.id, frame.captured_at_ms, clock));
        let event = json!({"kind":"image-received","id":frame.id,"capturedAtMs":frame.captured_at_ms,"clock":clock,"receivedAtMs":now});
        self.bytes += frame.image.data.len();
        self.frames.push_back(Received {
            frame,
            received_ms: now,
            clock,
        });
        self.expire(now);
        Ok(event)
    }
    fn remove_oldest(&mut self) {
        if let Some(frame) = self.frames.pop_front() {
            self.bytes -= frame.frame.image.data.len();
            self.evicted += 1;
        }
    }
    fn expire(&mut self, now: u64) {
        let newest = self.frames.back().map_or(0, |f| f.frame.captured_at_ms);
        while self.frames.front().is_some_and(|f| {
            now.saturating_sub(f.received_ms) > WINDOW_MS
                || newest.saturating_sub(f.frame.captured_at_ms) > WINDOW_MS
                || self.frames.len()
                    > if self.mode == CameraContext::Latest {
                        1
                    } else {
                        300
                    }
                || self.bytes > BUFFER_BYTES
        }) {
            self.remove_oldest();
        }
    }
    pub fn attach(&mut self, message: &mut Message, now: u64) {
        self.expire(now);
        let mut candidates: Vec<_> = self
            .frames
            .iter()
            .filter(|f| self.committed.is_none_or(|id| f.frame.id > id))
            .collect();
        let reused = candidates.is_empty() && !self.frames.is_empty();
        if reused {
            candidates.extend(self.frames.back());
        }
        let mut chosen = BTreeSet::new();
        if let Some(latest) = candidates.last() {
            let current_capture_time = latest
                .frame
                .captured_at_ms
                .saturating_add(now.saturating_sub(latest.received_ms));
            if self.mode == CameraContext::Latest {
                chosen.insert(candidates.len() - 1);
            } else if candidates.len() <= 12 {
                chosen.extend(0..candidates.len());
            } else {
                chosen.extend(
                    candidates
                        .iter()
                        .enumerate()
                        .rev()
                        .filter(|(_, f)| {
                            current_capture_time.saturating_sub(f.frame.captured_at_ms) < 6000
                        })
                        .take(6)
                        .map(|(i, _)| i),
                );
                // Always include the newest available observation, even after capture pauses.
                chosen.insert(candidates.len() - 1);
                let earlier: Vec<_> = (0..candidates.len())
                    .filter(|i| !chosen.contains(i))
                    .collect();
                let slots = (12 - chosen.len()).min(earlier.len());
                let first = candidates[*earlier.first().unwrap()].frame.captured_at_ms;
                let last = candidates[*earlier.last().unwrap()].frame.captured_at_ms;
                for n in 0..slots {
                    let target = first + (last - first) * n as u64 / (slots - 1).max(1) as u64;
                    if let Some(index) = earlier
                        .iter()
                        .filter(|i| !chosen.contains(i))
                        .min_by_key(|&&i| candidates[i].frame.captured_at_ms.abs_diff(target))
                    {
                        chosen.insert(*index);
                    }
                }
            }
        }
        // Keep the newest frames first when encoded image size forces a smaller request.
        let mut bytes = 0;
        chosen = chosen
            .into_iter()
            .rev()
            .filter(|&i| {
                let size = candidates[i].frame.image.data.len();
                if bytes + size > REQUEST_BYTES {
                    false
                } else {
                    bytes += size;
                    true
                }
            })
            .collect();
        let start = message.items.len();
        let mut selected = vec![];
        for i in chosen {
            let received = candidates[i];
            let f = &received.frame;
            let label = format!(
                "Camera frame {} at {}.{:03}s ({} clock, session-relative).",
                f.id,
                f.captured_at_ms / 1000,
                f.captured_at_ms % 1000,
                received.clock
            );
            message.items.push(Item::Text { text: label });
            message.items.push(Item::Image {
                url: None,
                base64: Some(f.image.data.clone()),
                mime_type: Some(f.image.mime_type.clone()),
            });
            selected
                .push(json!({"id":f.id,"capturedAtMs":f.captured_at_ms,"clock":received.clock}));
        }
        let meta = json!({"itemStart":start,"frames":selected,"policy":self.mode,"candidateCount":candidates.len(),"omittedCount":candidates.len()-selected.len(),"evictedSincePreviousTurn":self.evicted,"reusedLatest":reused,"encodedBytes":bytes,"windowMs":WINDOW_MS});
        message.meta.get_or_insert_with(|| json!({}))["cascadeCamera"] = meta;
        self.committed = self.last.map(|(id, _, _)| id);
        self.evicted = 0;
    }
}

/// Camera attachments are temporary. Preserve all original text and user/tool images.
pub(super) fn prune(message: &mut Message) {
    if let Some(meta) = message
        .meta
        .as_mut()
        .and_then(|m| m.get_mut("cascadeCamera"))
        && let Some(start) = meta["itemStart"].as_u64()
    {
        message.items.truncate(start as usize);
        meta["pruned"] = json!(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(id: u64, time: u64) -> CameraFrame {
        CameraFrame {
            id,
            captured_at_ms: time,
            image: LiveImage {
                data: "YWJj".into(),
                mime_type: "image/jpeg".into(),
            },
        }
    }
    fn selected(buffer: &mut CameraBuffer, now: u64) -> Value {
        let mut message = Message::user("What did we pass?");
        buffer.attach(&mut message, now);
        message.meta.unwrap()["cascadeCamera"].clone()
    }
    #[test]
    fn short_interval_includes_every_frame_then_only_new_frames() {
        let mut buffer = CameraBuffer::new(CameraContext::Recent);
        for id in 1..=10 {
            buffer
                .push(Some(frame(id, id * 1000)), None, id * 1000)
                .unwrap();
        }
        let selection = selected(&mut buffer, 10_000);
        assert_eq!(selection["frames"].as_array().unwrap().len(), 10);
        buffer.push(Some(frame(11, 11_000)), None, 11_000).unwrap();
        assert_eq!(
            selected(&mut buffer, 11_000)["frames"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(selected(&mut buffer, 12_000)["reusedLatest"], true);
    }
    #[test]
    fn long_interval_keeps_recent_six_and_spreads_earlier_frames_by_time() {
        let mut buffer = CameraBuffer::new(CameraContext::Recent);
        for id in 1..=60 {
            buffer
                .push(Some(frame(id, id * 1000)), None, id * 1000)
                .unwrap();
        }
        let selection = selected(&mut buffer, 60_000);
        let ids: Vec<_> = selection["frames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["id"].as_u64().unwrap())
            .collect();
        assert_eq!(ids, vec![1, 12, 22, 33, 43, 54, 55, 56, 57, 58, 59, 60]);
        assert_eq!(selection["omittedCount"], 48);
    }
    #[test]
    fn irregular_capture_is_spaced_by_timestamp_not_frame_index() {
        let mut buffer = CameraBuffer::new(CameraContext::Recent);
        for (i, time) in [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30_000, 60_000, 90_000, 120_000, 150_000, 180_000,
        ]
        .iter()
        .enumerate()
        {
            buffer
                .push(Some(frame(i as u64 + 1, *time)), None, *time)
                .unwrap();
        }
        let selection = selected(&mut buffer, 180_000);
        let times: Vec<_> = selection["frames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["capturedAtMs"].as_u64().unwrap())
            .collect();
        for time in [30_000, 60_000, 90_000, 120_000, 150_000, 180_000] {
            assert!(times.contains(&time));
        }
        assert_eq!(times.len(), 12);
    }
    #[test]
    fn bounds_age_count_and_rejects_reordered_input() {
        let mut buffer = CameraBuffer::new(CameraContext::Recent);
        for id in 1..=400 {
            buffer
                .push(Some(frame(id, id * 1000)), None, id * 1000)
                .unwrap();
        }
        assert_eq!(buffer.frames.len(), 300);
        assert!(
            buffer
                .push(Some(frame(400, 400_000)), None, 400_000)
                .is_err()
        );
        assert!(buffer.push(Some(frame(401, 1)), None, 400_000).is_err());
        let selection = selected(&mut buffer, 701_000);
        assert!(selection["frames"].as_array().unwrap().is_empty());
        assert_eq!(selection["evictedSincePreviousTurn"], 400);
    }
    #[test]
    fn byte_limits_keep_latest_and_pruning_preserves_original_images() {
        let mut buffer = CameraBuffer::new(CameraContext::Recent);
        for id in 1..=20 {
            let mut f = frame(id, id * 1000);
            f.image.data = "YWJj".repeat(512 * 1024);
            buffer.push(Some(f), None, id * 1000).unwrap();
        }
        assert_eq!(buffer.frames.len(), 16);
        let mut message = Message::user("original");
        message.items.push(Item::Image {
            url: Some("https://example.com/original.png".into()),
            base64: None,
            mime_type: None,
        });
        let original = message.items.clone();
        buffer.attach(&mut message, 20_000);
        let meta = &message.meta.as_ref().unwrap()["cascadeCamera"];
        assert_eq!(meta["frames"].as_array().unwrap().len(), 2);
        assert_eq!(meta["frames"][1]["id"], 20);
        prune(&mut message);
        assert_eq!(message.items, original);
    }
    #[test]
    fn latest_policy_and_legacy_receipt_clock_remain_explicit() {
        let mut buffer = CameraBuffer::new(CameraContext::Latest);
        for time in 0..20 {
            buffer.push(None, Some(frame(0, 0).image), time).unwrap();
        }
        let selection = selected(&mut buffer, 20);
        assert_eq!(selection["frames"].as_array().unwrap().len(), 1);
        assert_eq!(selection["frames"][0]["clock"], "receipt");
        assert!(buffer.push(Some(frame(30, 30)), None, 30).is_err());
    }
}
