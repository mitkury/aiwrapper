//! A bounded STT → language provider → speech pipeline. LiveAgent executes tools.
use super::camera::{CameraBuffer, prune};
use super::*;
use crate::speech_stream::{
    SpeechEvent, SpeechOutput, SpeechTiming, TranscriptionEvent, TranscriptionSession,
};
use futures_util::StreamExt;
use serde_json::json;
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

pub struct CascadeConfig {
    pub language: Arc<dyn LanguageProvider>,
    pub speech: Arc<dyn SpeechOutput>,
    pub transcription: Option<TranscriptionSession>,
    pub conversation: Conversation,
    pub tools: Vec<ToolDefinition>,
    pub cancellation: CancellationToken,
    pub camera_context: CameraContext,
}
impl CascadeConfig {
    pub fn new(language: Arc<dyn LanguageProvider>, speech: Arc<dyn SpeechOutput>) -> Self {
        Self {
            language,
            speech,
            transcription: None,
            camera_context: CameraContext::Latest,
            conversation: Conversation::default(),
            tools: vec![],
            cancellation: CancellationToken::new(),
        }
    }
    pub fn connect(self) -> Result<LiveSession> {
        self.conversation.validate()?;
        let cancellation = self.cancellation.child_token();
        let (commands, rx) = mpsc::channel(32);
        let (events, output) = mpsc::channel(128);
        let generation = Arc::new(AtomicU64::new(0));
        let failure = Arc::new(std::sync::Mutex::new(None));
        let input = self.transcription.as_ref().map(|s| s.input.clone());
        let sender = CascadeSender {
            commands,
            cancellation: cancellation.clone(),
            input,
        };
        let receiver = CascadeReceiver {
            events: output,
            failure: failure.clone(),
            queued: VecDeque::new(),
            cancellation: cancellation.clone(),
            generation: generation.clone(),
        };
        let tools = self.tools.clone();
        let speech_input = self.transcription.as_ref().map(|s| s.input.clone());
        tokio::spawn(async move {
            let mut actor = Actor::new(self, events.clone(), cancellation.clone(), generation);
            let result = actor.run(rx).await;
            actor.cancel_work();
            if let Err(error) = result {
                *failure.lock().unwrap() = Some(error);
            }
            cancellation.cancel();
            if let Some(input) = speech_input {
                let _ = tokio::time::timeout(Duration::from_secs(1), input.close()).await;
            }
        });
        Ok(LiveSession {
            sender: LiveSender {
                backend: SenderBackend::Cascade(sender),
            },
            receiver: LiveReceiver {
                backend: ReceiverBackend::Cascade(receiver),
            },
            tools,
        })
    }
}
#[derive(Clone)]
pub(super) struct CascadeSender {
    commands: mpsc::Sender<(Command, oneshot::Sender<Result<()>>)>,
    cancellation: CancellationToken,
    input: Option<Arc<dyn crate::speech_stream::SpeechInput>>,
}
enum Command {
    Text(String, Role, bool),
    Image(LiveImage),
    Camera(CameraFrame),
    Results(Vec<LiveToolResult>),
    Interrupt,
    Played(String, usize, u64),
    PlaybackStopped(String),
}
impl CascadeSender {
    async fn request(&self, command: Command) -> Result<()> {
        crate::error::check_cancel(&self.cancellation)?;
        let (tx, rx) = oneshot::channel();
        self.commands
            .try_send((command, tx))
            .map_err(|_| Error::Protocol("cascade command queue full or closed".into()))?;
        tokio::select! {
            biased;
            result = rx => result.map_err(|_| Error::Cancelled)?,
            _ = self.cancellation.cancelled() => Err(Error::Cancelled),
        }
    }

    pub fn input_sample_rate(&self) -> u32 {
        self.input.as_ref().map_or(24000, |i| i.sample_rate())
    }
    pub async fn append_audio(&self, frame: &PcmFrame) -> Result<()> {
        let input = self
            .input
            .as_ref()
            .ok_or_else(|| Error::Invalid("this session has no transcription provider".into()))?;
        tokio::select! { biased; _ = self.cancellation.cancelled() => Err(Error::Cancelled), result = input.append(frame) => result }
    }
    pub async fn end_audio(&self) -> Result<()> {
        let input = self
            .input
            .as_ref()
            .ok_or_else(|| Error::Invalid("this session has no transcription provider".into()))?;
        tokio::select! { biased; _ = self.cancellation.cancelled() => Err(Error::Cancelled), result = input.end_turn() => result }
    }
    pub async fn send_text(&self, text: &str, role: Role, complete: bool) -> Result<()> {
        if text.trim().is_empty() || text.len() > 32768 || role == Role::ToolResults {
            return Err(Error::Invalid(
                "text requires 1–32768 bytes and a user/assistant role".into(),
            ));
        }
        self.request(Command::Text(text.into(), role, complete))
            .await
    }
    pub async fn append_image(&self, data: &str, mime: &str) -> Result<()> {
        let image = LiveImage {
            data: data.into(),
            mime_type: mime.into(),
        };
        image.validate()?;
        if data.len() > 2 * 1024 * 1024 {
            return Err(Error::Invalid("camera image exceeds 2 MiB".into()));
        }
        self.request(Command::Image(image)).await
    }
    pub async fn append_camera_frame(&self, frame: &CameraFrame) -> Result<()> {
        frame.validate()?;
        self.request(Command::Camera(frame.clone())).await
    }
    pub async fn send_tool_results(&self, results: &[LiveToolResult]) -> Result<()> {
        self.request(Command::Results(results.to_vec())).await
    }
    pub async fn interrupt(&self) -> Result<()> {
        self.request(Command::Interrupt).await
    }
    pub async fn truncate_audio(&self, id: &str, index: usize, ms: u64) -> Result<()> {
        self.request(Command::Played(id.into(), index, ms)).await
    }
    pub async fn playback_stopped(&self, id: &str) -> Result<()> {
        self.request(Command::PlaybackStopped(id.into())).await
    }
    pub async fn close(&self) -> Result<()> {
        self.cancellation.cancel();
        Ok(())
    }
}
type Output = (Option<u64>, Result<Vec<LiveEvent>>);
pub(super) struct CascadeReceiver {
    events: mpsc::Receiver<Output>,
    failure: Arc<std::sync::Mutex<Option<Error>>>,
    queued: VecDeque<LiveEvent>,
    cancellation: CancellationToken,
    generation: Arc<AtomicU64>,
}
impl CascadeReceiver {
    pub async fn next_events(&mut self) -> Result<Option<Vec<LiveEvent>>> {
        if let Some(error) = self.failure.lock().unwrap().take() {
            return Err(error);
        }
        if !self.queued.is_empty() {
            return Ok(Some(self.queued.drain(..).collect()));
        }
        loop {
            let output = tokio::select! { biased; value = self.events.recv() => value, _ = self.cancellation.cancelled() => self.events.try_recv().ok() };
            let Some((generation, result)) = output else {
                if let Some(error) = self.failure.lock().unwrap().take() {
                    return Err(error);
                }
                return Ok(None);
            };
            if generation.is_none_or(|g| g == self.generation.load(Ordering::SeqCst)) {
                return result.map(Some);
            }
        }
    }
    pub async fn next_event(&mut self) -> Result<Option<LiveEvent>> {
        if let Some(event) = self.queued.pop_front() {
            return Ok(Some(event));
        }
        if let Some(events) = self.next_events().await? {
            self.queued.extend(events);
        }
        Ok(self.queued.pop_front())
    }
    pub async fn drain_received(&mut self) -> Result<Vec<LiveEvent>> {
        let mut events: Vec<_> = self.queued.drain(..).collect();
        while let Ok((generation, result)) = self.events.try_recv() {
            if generation.is_none_or(|g| g == self.generation.load(Ordering::SeqCst)) {
                events.extend(result?);
            }
        }
        Ok(events)
    }
}
impl Drop for CascadeReceiver {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

enum Work {
    ProviderRequest(crate::ProviderRequest),
    Text(String),
    Done(Result<Message>),
    Audio(usize, PcmFrame),
    SegmentDone(usize),
    Timing(usize, Vec<SpeechTiming>),
    SynthesisText(usize, String),
    Synthesized,
    Failed(Error),
}
struct Segment {
    start: usize,
    end: usize,
    timing: Vec<SpeechTiming>,
    samples: u64,
    rate: u32,
    played_ms: u64,
    done: bool,
}
struct Round {
    id: u64,
    message: usize,
    text: String,
    segmented: usize,
    segments: Vec<Segment>,
    synthesis: Option<mpsc::Sender<(usize, String)>>,
    model_done: bool,
    synthesis_done: bool,
    cut: bool,
}
/// The same cutoff is used for conversation history and host transcript display.
/// `provider-timed` refers to provider alignment, not proof of human perception.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackCut {
    pub item_id: String,
    pub played_ms: u64,
    pub generated_ms: u64,
    pub retained_text: String,
    pub unplayed_text: String,
    pub accuracy: String,
    pub playback_confirmed: bool,
}
impl Segment {
    fn duration_ms(&self) -> u64 {
        self.samples * 1000 / u64::from(self.rate.max(1))
    }
}
impl Round {
    fn playback_cut(&self, confirmed: bool) -> PlaybackCut {
        let mut end = 0;
        let mut accuracy = "segment-boundary";
        for segment in &self.segments {
            if segment.done && segment.played_ms >= segment.duration_ms() && segment.samples > 0 {
                end = segment.end;
                continue;
            }
            if segment.played_ms == 0 {
                break;
            }
            let text = &self.text[segment.start..segment.end];
            let aligned_through = segment.timing.last().map_or(0, |p| p.end_ms);
            if aligned_through >= segment.played_ms {
                let at = segment
                    .timing
                    .iter()
                    .take_while(|p| p.end_ms <= segment.played_ms)
                    .last()
                    .map_or(0, |p| p.text_end);
                end = segment.start + word_boundary(text, at);
                accuracy = "provider-timed";
            } else if segment.done && segment.duration_ms() > 0 {
                let count = text.chars().count() as u64 * segment.played_ms / segment.duration_ms();
                let at = text
                    .char_indices()
                    .nth(count as usize)
                    .map_or(text.len(), |(at, _)| at);
                end = segment.start + word_boundary(text, at);
                accuracy = "estimated";
            } else {
                // Incomplete synthesis has no known total duration. Do not
                // extrapolate a word position from a growing audio denominator.
                accuracy = "segment-boundary";
            }
            break;
        }
        PlaybackCut {
            item_id: self.id.to_string(),
            played_ms: self.segments.iter().map(|s| s.played_ms).sum(),
            generated_ms: self.segments.iter().map(Segment::duration_ms).sum(),
            retained_text: self.text[..end].to_owned(),
            unplayed_text: self.text[end..].to_owned(),
            accuracy: accuracy.into(),
            playback_confirmed: confirmed,
        }
    }
}
// Back out of a partially spoken whitespace-delimited word. Scripts without
// spaces use character boundaries; this is not a linguistic word tokenizer.
fn word_boundary(text: &str, at: usize) -> usize {
    if at == 0 || at == text.len() {
        return at;
    }
    let left = &text[..at];
    if left.chars().last().is_some_and(char::is_whitespace)
        || text[at..]
            .chars()
            .next()
            .is_some_and(|c| c.is_whitespace() || c.is_ascii_punctuation())
    {
        return at;
    }
    left.char_indices()
        .rev()
        .find(|(_, c)| c.is_whitespace())
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or_else(|| if text.is_ascii() { 0 } else { at })
}
struct Actor {
    config: CascadeConfig,
    output: mpsc::Sender<Output>,
    cancel: CancellationToken,
    generation: Arc<AtomicU64>,
    work_cancel: CancellationToken,
    work_tx: mpsc::Sender<(u64, Work)>,
    work_rx: mpsc::Receiver<(u64, Work)>,
    round: Option<Round>,
    pending: BTreeMap<String, String>,
    seen_calls: HashSet<String>,
    queued: VecDeque<Message>,
    camera: CameraBuffer,
    started: tokio::time::Instant,
    last_turn: Option<u64>,
    rounds: usize,
    continuation: Option<tokio::time::Instant>,
    cut_wait: Option<tokio::time::Instant>,
    start_pending: bool,
}
impl Actor {
    fn new(
        config: CascadeConfig,
        output: mpsc::Sender<Output>,
        cancel: CancellationToken,
        generation: Arc<AtomicU64>,
    ) -> Self {
        let (work_tx, work_rx) = mpsc::channel(128);
        Self {
            camera: CameraBuffer::new(config.camera_context),
            started: tokio::time::Instant::now(),
            config,
            output,
            cancel,
            generation,
            work_cancel: CancellationToken::new(),
            work_tx,
            work_rx,
            round: None,
            pending: BTreeMap::new(),
            seen_calls: HashSet::new(),
            queued: VecDeque::new(),
            last_turn: None,
            rounds: 0,
            continuation: None,
            cut_wait: None,
            start_pending: false,
        }
    }
    fn emit(&self, generation: Option<u64>, events: Vec<LiveEvent>) -> Result<()> {
        self.output.try_send((generation, Ok(events))).map_err(|_| {
            Error::Protocol("cascade output overflow; consumer must keep polling".into())
        })
    }
    fn diagnostic(&self, state: Value) -> Result<()> {
        self.emit(None, vec![LiveEvent::ProviderState { state }])
    }
    fn cancel_work(&mut self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.work_cancel.cancel();
    }
    async fn run(
        &mut self,
        mut commands: mpsc::Receiver<(Command, oneshot::Sender<Result<()>>)>,
    ) -> Result<()> {
        let mut transcription = self.config.transcription.take().map(|s| s.events);
        let mut flush = tokio::time::interval(Duration::from_millis(200));
        self.diagnostic(json!({"kind":"connected","runtime":"rust"}))?;
        loop {
            tokio::select! {
                biased;
                _ = self.cancel.cancelled() => return Ok(()),
                command = commands.recv() => {
                    let Some((command,reply)) = command else { return Ok(()) };
                    let result = self.command(command);
                    let _ = reply.send(result);
                }
                event = async { match &mut transcription { Some(stream)=>stream.next().await, None=>std::future::pending().await } } => {
                    let event = event.ok_or_else(||Error::Protocol("transcription stream ended".into()))??;
                    match event {
                        TranscriptionEvent::Started { id } => { self.interrupt()?; self.emit(None,vec![LiveEvent::SpeechStarted {id:Some(id)}])?; }
                        TranscriptionEvent::Transcript {id,text,committed} => {
                            let turn = id.parse::<u64>().map_err(|_| Error::Protocol("transcription turn IDs must be increasing integers".into()))?;
                            if committed && self.last_turn.is_some_and(|last|turn<=last) { continue; }
                            self.emit(None,vec![LiveEvent::Transcript {input:true,text:text.clone(),final_result:committed,id:Some(id),text_output:false}])?;
                            if committed { self.last_turn=Some(turn); if !text.trim().is_empty() {self.commit(Message::user(text))?;} }
                        }
                        TranscriptionEvent::Observation {event} => self.diagnostic(json!({"kind":"stt","event":event}))?,
                    }
                }
                Some((generation,work)) = self.work_rx.recv() => {
                    if generation == self.generation.load(Ordering::SeqCst) { self.work(work)?; }
                }
                _ = flush.tick() => {
                    if self.continuation.is_some_and(|t|t.elapsed()>Duration::from_secs(30)) { return Err(Error::Protocol("playback acknowledgement timed out before tool continuation".into())); }
                    if self.cut_wait.is_some_and(|at| at.elapsed() >= Duration::from_millis(500)) { self.finish_cut(false)?; }
                    self.segment(SegmentTrigger::Timer)?;
                },
            }
        }
    }
    fn command(&mut self, command: Command) -> Result<()> {
        match command {
            Command::Text(text, role, true) => {
                self.emit(
                    None,
                    vec![LiveEvent::Transcript {
                        input: true,
                        text: text.clone(),
                        final_result: true,
                        id: None,
                        text_output: true,
                    }],
                )?;
                self.commit(Message::text(role, text))
            }
            Command::Text(text, role, false) => {
                if self.round.as_ref().is_some_and(|r| !r.model_done) || !self.pending.is_empty() {
                    return Err(Error::Invalid(
                        "silent context requires an idle model".into(),
                    ));
                }
                self.config
                    .conversation
                    .messages
                    .push(Message::text(role, text));
                Ok(())
            }
            Command::Image(image) => {
                let event = self.camera.push(
                    None,
                    Some(image),
                    self.started.elapsed().as_millis() as u64,
                )?;
                self.diagnostic(event)
            }
            Command::Camera(frame) => {
                let event = self.camera.push(
                    Some(frame),
                    None,
                    self.started.elapsed().as_millis() as u64,
                )?;
                self.diagnostic(event)
            }
            Command::Interrupt => self.interrupt(),
            Command::PlaybackStopped(id) => {
                if self.cut_wait.is_some()
                    && self.round.as_ref().is_some_and(|r| r.id.to_string() == id)
                {
                    self.finish_cut(true)?;
                }
                Ok(())
            }
            Command::Played(id, index, ms) => {
                let Some(round) = self.round.as_mut().filter(|r| r.id.to_string() == id) else {
                    if id
                        .parse::<u64>()
                        .is_ok_and(|n| n < self.generation.load(Ordering::SeqCst))
                    {
                        return Ok(());
                    }
                    return Err(Error::Invalid("unknown playback item".into()));
                };
                if round.cut && self.cut_wait.is_none() {
                    return Ok(());
                }
                let segment = round
                    .segments
                    .get_mut(index)
                    .ok_or_else(|| Error::Invalid("unknown audio segment".into()))?;
                let duration = segment.samples * 1000 / u64::from(segment.rate.max(1));
                if ms > duration {
                    return Err(Error::Invalid(
                        "playback cursor exceeds generated audio".into(),
                    ));
                }
                segment.played_ms = segment.played_ms.max(ms);
                self.advance()
            }
            Command::Results(results) => {
                let mut ids = HashSet::new();
                for result in &results {
                    if self.pending.get(&result.call_id) != Some(&result.name)
                        || !ids.insert(&result.call_id)
                    {
                        return Err(Error::Invalid(
                            "unknown, duplicate or mismatched cascade tool result".into(),
                        ));
                    }
                    for image in &result.images {
                        image.validate()?;
                    }
                }
                if results.is_empty() {
                    return Ok(());
                }
                let mut items = vec![];
                for result in results {
                    self.pending.remove(&result.call_id);
                    let result_value = if result.images.is_empty() {
                        result.result
                    } else {
                        let mut content =
                            vec![json!({"type":"text","text":result.result.to_string()})];
                        content.extend(result.images.iter().map(
                            |i| json!({"type":"image","base64":i.data,"mimeType":i.mime_type}),
                        ));
                        json!({"type":"tool-content","content":content})
                    };
                    items.push(Item::ToolResult {
                        call_id: result.call_id,
                        name: result.name,
                        result: result_value,
                    });
                }
                self.config
                    .conversation
                    .messages
                    .push(Message::new(Role::ToolResults, items));
                if self.pending.is_empty() {
                    let silent = self
                        .config
                        .conversation
                        .messages
                        .iter()
                        .rev()
                        .find(|m| m.role == Role::Assistant)
                        .is_some_and(|m| {
                            m.items
                                .iter()
                                .filter_map(|i| {
                                    if let Item::Tool { name, .. } = i {
                                        Some(name)
                                    } else {
                                        None
                                    }
                                })
                                .all(|name| {
                                    self.config
                                        .tools
                                        .iter()
                                        .any(|t| &t.name == name && t.silent)
                                })
                        });
                    if !self.queued.is_empty() {
                        self.config
                            .conversation
                            .messages
                            .extend(self.queued.drain(..));
                        self.start()?;
                    } else if !silent && !self.round.as_ref().is_some_and(|r| r.cut) {
                        self.continuation = Some(tokio::time::Instant::now());
                        self.advance()?;
                    }
                    self.diagnostic(
                        json!({"kind":"history","conversation":self.config.conversation}),
                    )?;
                }
                Ok(())
            }
        }
    }
    fn commit(&mut self, mut message: Message) -> Result<()> {
        if self.queued.len() >= 8 {
            return Err(Error::Invalid(
                "too many turns waiting for tool results".into(),
            ));
        }
        self.interrupt()?;
        self.camera
            .attach(&mut message, self.started.elapsed().as_millis() as u64);
        if !self.pending.is_empty() {
            self.queued.push_back(message);
            return self.diagnostic(json!({"kind":"waiting-for-tools"}));
        }
        self.config.conversation.messages.push(message);
        self.rounds = 0;
        self.start()
    }
    fn interrupt(&mut self) -> Result<()> {
        self.continuation = None;
        self.cancel_work();
        if let Some(round) = self.round.as_mut().filter(|r| !r.cut) {
            round.cut = true;
            // A completed, acknowledged reply is not an interruption.
            if round.model_done
                && round.synthesis_done
                && round
                    .segments
                    .iter()
                    .all(|s| s.done && s.played_ms >= s.duration_ms())
            {
                return Ok(());
            }
            self.cut_wait = Some(tokio::time::Instant::now());
            let id = round.id.to_string();
            self.emit(None, vec![LiveEvent::Interrupted])?;
            self.diagnostic(json!({"kind":"playback-stop-requested","itemId":id}))?;
        }
        Ok(())
    }
    fn finish_cut(&mut self, confirmed: bool) -> Result<()> {
        self.cut_wait = None;
        if let Some(round) = &self.round {
            let cut = round.playback_cut(confirmed);
            let message = &mut self.config.conversation.messages[round.message];
            replace_visible_text(message, &cut.retained_text)?;
            // Metadata is diagnostic, not provider replay content. The discarded
            // tail is emitted to the host, never retained in model history.
            if !cut.unplayed_text.is_empty() {
                let meta = message.meta.get_or_insert_with(|| json!({}));
                meta["cascadeInterruption"] =
                    json!({"itemId":cut.item_id,"playedMs":cut.played_ms,"accuracy":cut.accuracy});
                self.diagnostic(json!({"kind":"playback-cut","cut":cut}))?;
            }
            self.diagnostic(json!({"kind":"history","conversation":self.config.conversation}))?;
        }
        if std::mem::take(&mut self.start_pending) {
            self.start()?;
        }
        Ok(())
    }
    fn advance(&mut self) -> Result<()> {
        if self.continuation.is_some()
            && self.round.as_ref().is_some_and(|r| {
                r.synthesis_done
                    && r.segments.iter().all(|s| {
                        s.done && s.played_ms >= s.samples * 1000 / u64::from(s.rate.max(1))
                    })
            })
        {
            self.continuation = None;
            self.start()?;
        }
        Ok(())
    }
    fn start(&mut self) -> Result<()> {
        if self.cut_wait.is_some() {
            self.start_pending = true;
            return Ok(());
        }
        self.continuation = None;
        self.cancel_work();
        self.rounds += 1;
        if self.rounds > 12 || self.config.conversation.messages.len() > 256 {
            return Err(Error::Invalid(
                "cascade conversation/round limit reached; start a new session".into(),
            ));
        }
        // Keep this turn's frozen images through tool continuations, but release
        // camera payloads from older turns. Caller/tool images are unrelated.
        let last_user = self
            .config
            .conversation
            .messages
            .iter()
            .rposition(|m| m.role == Role::User);
        for (index, message) in self.config.conversation.messages.iter_mut().enumerate() {
            if Some(index) != last_user {
                prune(message);
            }
        }
        let mut conversation = self.config.conversation.clone();
        if let Some(message) = conversation.messages.iter().rev().find(|m| {
            m.meta
                .as_ref()
                .is_some_and(|v| v.get("cascadeInterruption").is_some())
        }) {
            let retained = message.answer();
            let quote: String = retained
                .chars()
                .rev()
                .take(160)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            conversation.instructions.push_str(&format!("\nPlayback context: an earlier assistant reply was interrupted. Its retained text ends with {}. Any generated continuation was not played and has been removed. The cutoff may be approximate; acknowledge interruptions without claiming the user heard the full reply.", serde_json::to_string(&quote)?));
        }
        let camera = last_user
            .and_then(|i| conversation.messages.get(i))
            .and_then(|m| m.meta.as_ref())
            .and_then(|m| m.get("cascadeCamera"))
            .cloned();
        conversation.messages.retain(|m| !m.items.is_empty());
        conversation.validate()?;
        if serde_json::to_vec(&self.config.conversation)?.len() > 8 * 1024 * 1024 {
            return Err(Error::Invalid(
                "conversation exceeds 8 MiB; start a new session".into(),
            ));
        }
        let generation = self.generation.load(Ordering::SeqCst);
        self.diagnostic(json!({"kind":"request","itemId":generation.to_string(),"camera":camera,"conversation":conversation,"tools":self.config.tools,"maxTokens":1024}))?;
        self.work_cancel = self.cancel.child_token();
        let cancel = self.work_cancel.clone();
        let language = self.config.language.clone();
        let tx = self.work_tx.clone();
        let request_tx = tx.clone();
        let options = ChatOptions {
            on_request: Some(Arc::new(move |request| {
                // Diagnostics use the same bounded, generation-checked queue as model updates.
                let _ = request_tx.try_send((generation, Work::ProviderRequest(request)));
            })),
            cancellation: cancel.clone(),
            tools: Some(self.config.tools.clone()),
            max_tokens: Some(1024),
            max_retries: 0,
            ..Default::default()
        };
        tokio::spawn(async move {
            let mut overflow = false;
            let mut update = |m: &Message| {
                if tx.try_send((generation, Work::Text(m.answer()))).is_err() {
                    overflow = true;
                    cancel.cancel();
                }
            };
            let result = tokio::select! { biased; _=cancel.cancelled()=>Err(Error::Cancelled), _=tokio::time::sleep(Duration::from_secs(60))=>Err(Error::Protocol("language response timed out".into())), result=language.complete(&conversation,&options,&mut update)=>result };
            let result = if overflow {
                Err(Error::Protocol("language update queue overflow".into()))
            } else {
                result
            };
            let _ = tx.send((generation, Work::Done(result))).await;
        });
        let (synthesis, mut segments) = mpsc::channel::<(usize, String)>(32);
        let speech = self.config.speech.clone();
        let tx = self.work_tx.clone();
        let cancel = self.work_cancel.clone();
        let task_cancel = cancel.clone();
        let synthesis_work = async move {
            let result: Result<()> = async {
                while let Some((index, text)) = segments.recv().await {
                    tx.send((generation, Work::SynthesisText(index, text.clone())))
                        .await
                        .map_err(|_| Error::Cancelled)?;
                    let mut stream = tokio::time::timeout(
                        Duration::from_secs(15),
                        speech.synthesize_timed(&text, cancel.clone()),
                    )
                    .await
                    .map_err(|_| Error::Protocol("speech setup timed out".into()))??;
                    while let Some(frame) =
                        tokio::time::timeout(Duration::from_secs(15), stream.next())
                            .await
                            .map_err(|_| Error::Protocol("speech stream timed out".into()))?
                    {
                        let frame = match frame? {
                            SpeechEvent::Audio(frame) => frame,
                            SpeechEvent::Timing(points) => {
                                tx.send((generation, Work::Timing(index, points)))
                                    .await
                                    .map_err(|_| Error::Cancelled)?;
                                continue;
                            }
                        };
                        frame.validate()?;
                        // At most 100 ms per queued frame, independent of provider chunking.
                        for samples in frame.samples.chunks((frame.sample_rate / 10) as usize) {
                            tx.send((
                                generation,
                                Work::Audio(
                                    index,
                                    PcmFrame {
                                        samples: samples.to_vec(),
                                        sample_rate: frame.sample_rate,
                                    },
                                ),
                            ))
                            .await
                            .map_err(|_| Error::Cancelled)?;
                        }
                    }
                    tx.send((generation, Work::SegmentDone(index)))
                        .await
                        .map_err(|_| Error::Cancelled)?;
                }
                tx.send((generation, Work::Synthesized))
                    .await
                    .map_err(|_| Error::Cancelled)?;
                Ok(())
            }
            .await;
            if let Err(error) = result {
                let _ = tx.send((generation, Work::Failed(error))).await;
            }
        };
        tokio::spawn(async move {
            tokio::select! { biased; _=task_cancel.cancelled()=>{}, _=synthesis_work=>{} }
        });
        let message = self.config.conversation.messages.len();
        self.config
            .conversation
            .messages
            .push(Message::assistant(""));
        self.round = Some(Round {
            id: generation,
            message,
            text: String::new(),
            segmented: 0,
            segments: vec![],
            synthesis: Some(synthesis),
            model_done: false,
            synthesis_done: false,
            cut: false,
        });
        self.emit(Some(generation), vec![LiveEvent::ResponseStarted])
    }
    fn work(&mut self, work: Work) -> Result<()> {
        match work {
            Work::ProviderRequest(request) => self.diagnostic(json!({"kind":"provider-request","itemId":self.round.as_ref().unwrap().id.to_string(),"request":request})),
            Work::Text(text) => {
                let round = self.round.as_mut().unwrap();
                if text == round.text {
                    return Ok(());
                }
                if !text.starts_with(&round.text) || text.len() > 65536 {
                    return Err(Error::Protocol(
                        "language text revised or exceeded 64 KiB".into(),
                    ));
                }
                round.text = text.clone();
                self.config.conversation.messages[round.message] = Message::assistant(&text);
                let id = round.id;
                self.emit(
                    Some(id),
                    vec![LiveEvent::Transcript {
                        input: false,
                        text,
                        final_result: false,
                        id: Some(id.to_string()),
                        text_output: true,
                    }],
                )?;
                self.segment(SegmentTrigger::Update)
            }
            Work::Done(result) => {
                let message = result?;
                self.work(Work::Text(message.answer()))?;
                self.segment(SegmentTrigger::Finished)?;
                let round = self.round.as_mut().unwrap();
                round.model_done = true;
                // Closing this sender lets synthesis drain its queued segments.
                round.synthesis.take();
                let id = round.id;
                let mut events = vec![LiveEvent::Transcript {
                    input: false,
                    text: round.text.clone(),
                    final_result: true,
                    id: Some(id.to_string()),
                    text_output: true,
                }];
                for item in &message.items {
                    if let Item::Tool {
                        call_id,
                        name,
                        arguments,
                        ..
                    } = item
                    {
                        if !self.seen_calls.insert(call_id.clone()) {
                            return Err(Error::Protocol("model reused a tool call ID".into()));
                        }
                        self.pending.insert(call_id.clone(), name.clone());
                        events.push(LiveEvent::ToolCall {
                            call_id: call_id.clone(),
                            name: name.clone(),
                            arguments: arguments.clone(),
                        });
                    }
                }
                self.config.conversation.messages[round.message] = message;
                events.push(LiveEvent::ResponseEnded);
                self.emit(None, events)?;
                self.diagnostic(json!({"kind":"history","conversation":self.config.conversation}))
            }
            Work::Audio(index, frame) => {
                let round = self.round.as_mut().unwrap();
                let segment = &mut round.segments[index];
                if segment.rate != 0 && segment.rate != frame.sample_rate {
                    return Err(Error::Protocol(
                        "speech sample rate changed within a segment".into(),
                    ));
                }
                segment.rate = frame.sample_rate;
                segment.samples += frame.samples.len() as u64;
                let id = round.id;
                self.emit(
                    Some(id),
                    vec![LiveEvent::Audio {
                        frame,
                        item_id: Some(id.to_string()),
                        content_index: Some(index),
                    }],
                )
            }
            Work::SynthesisText(index, text) => self.diagnostic(json!({"kind":"tts-input","itemId":self.round.as_ref().unwrap().id.to_string(),"contentIndex":index,"text":text})),
            Work::Timing(index, points) => {
                let round = self.round.as_mut().unwrap();
                let segment = &mut round.segments[index];
                for point in points {
                    let previous = segment.timing.last();
                    if point.text_end > segment.end - segment.start
                        || !round.text.is_char_boundary(segment.start + point.text_end)
                        || previous.is_some_and(|p| point.text_end <= p.text_end || point.end_ms < p.end_ms)
                        || segment.timing.len() >= 65536 {
                        return Err(Error::Protocol("invalid speech alignment".into()));
                    }
                    segment.timing.push(point);
                }
                Ok(())
            }
            Work::SegmentDone(index) => {
                let round = self.round.as_mut().unwrap();
                round.segments[index].done = true;
                let segment = &round.segments[index];
                if segment.samples == 0 {
                    return Err(Error::Protocol("speech provider returned no audio".into()));
                }
                let state = json!({"kind":"segment-done","itemId":round.id.to_string(),"contentIndex":index,"durationMs":segment.samples*1000/u64::from(segment.rate.max(1))});
                self.diagnostic(state)
            }
            Work::Synthesized => {
                self.round.as_mut().unwrap().synthesis_done = true;
                self.diagnostic(json!({"kind":"synthesis-complete","itemId":self.round.as_ref().unwrap().id.to_string()}))?;
                self.advance()
            }
            Work::Failed(error) => Err(error),
        }
    }
    fn segment(&mut self, trigger: SegmentTrigger) -> Result<()> {
        let Some(round) = self.round.as_mut().filter(|r| !r.cut && !r.model_done) else {
            return Ok(());
        };
        loop {
            let remaining = &round.text[round.segmented..];
            let end = segment_end(remaining, trigger);
            if end == 0 {
                break;
            }
            let text = remaining[..end].to_string();
            let start = round.segmented;
            round.segmented += end;
            if text.trim().is_empty() {
                continue;
            }
            let index = round.segments.len();
            round
                .synthesis
                .as_ref()
                .unwrap()
                .try_send((index, text.clone()))
                .map_err(|_| Error::Protocol("speech text queue overflow".into()))?;
            round.segments.push(Segment {
                start,
                timing: vec![],
                end: round.segmented,
                samples: 0,
                rate: 0,
                played_ms: 0,
                done: false,
            });
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SegmentTrigger {
    Update,
    Timer,
    Finished,
}

fn segment_end(text: &str, trigger: SegmentTrigger) -> usize {
    let mut whitespace = 0;
    let mut chars = text.char_indices().peekable();
    let mut count = 0;
    while let Some((index, c)) = chars.next() {
        count += 1;
        let end = index + c.len_utf8();
        if c.is_whitespace() {
            whitespace = end;
        }
        let followed_by_space = chars.peek().is_some_and(|(_, next)| next.is_whitespace());
        let final_character = trigger == SegmentTrigger::Finished && end == text.len();
        // A trailing period in a streamed snapshot may still become a decimal,
        // abbreviation or URL. Wait for the next character (or model completion).
        if "。！？\n".contains(c)
            || (".!?".contains(c) && (followed_by_space || final_character))
            || (",;:".contains(c) && count >= 40 && followed_by_space)
        {
            return end;
        }
        // 160 characters is a target, not permission to cut an unfinished word.
        // A long unbroken token waits for its boundary or the final model result;
        // the response's existing 64 KiB limit still bounds storage.
        if count >= 160 && whitespace > 0 {
            return whitespace;
        }
    }
    match trigger {
        SegmentTrigger::Finished => text.len(),
        SegmentTrigger::Timer if text[..whitespace].trim().chars().count() >= 40 => whitespace,
        _ => 0,
    }
}

/// Edit only visible text, retaining opaque reasoning and tool replay fields.
fn replace_visible_text(message: &mut Message, text: &str) -> Result<()> {
    // Even an unchanged empty answer must lose its placeholder text item.
    // Otherwise an interruption before the first token replays an empty block.
    if !text.is_empty() && message.answer() == text {
        return Ok(());
    }
    let mut meta = message.meta.clone();
    if let Some(meta) = meta.as_mut() {
        for key in ["anthropicContent", "googleParts", "openaiOutput"] {
            if let Some(blocks) = meta.get_mut(key).and_then(Value::as_array_mut) {
                if key == "googleParts"
                    && blocks
                        .iter()
                        .any(|b| b.get("text").is_some() && b.get("thoughtSignature").is_some())
                {
                    return Err(Error::Invalid(
                        "cannot truncate signed Gemini text; reconnect the session".into(),
                    ));
                }
                match key {
                    "anthropicContent" => {
                        blocks.retain(|b| b["type"] != "text");
                        if !text.is_empty() {
                            blocks.push(json!({"type":"text","text":text}));
                        }
                    }
                    "googleParts" => {
                        blocks.retain(|b| b.get("text").is_none() || b["thought"] == true);
                        if !text.is_empty() {
                            blocks.push(json!({"text":text}));
                        }
                    }
                    _ => {
                        blocks.retain(|b| b["type"] != "message");
                        if !text.is_empty() {
                            blocks.push(json!({"type":"message","role":"assistant","content":[{"type":"output_text","text":text}]}));
                        }
                    }
                }
            }
        }
    }
    message.items.retain(|i| !matches!(i, Item::Text { .. }));
    if !text.is_empty() {
        message.items.push(Item::Text { text: text.into() });
    }
    message.meta = meta;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn playback_edit_preserves_opaque_reasoning_and_tool_replay() {
        for (key, raw) in [
            (
                "openaiOutput",
                json!([{"type":"reasoning","encrypted_content":"opaque"},{"type":"function_call","call_id":"a","name":"f","arguments":"{}"},{"type":"message","content":[{"type":"output_text","text":"unplayed"}]}]),
            ),
            (
                "anthropicContent",
                json!([{"type":"thinking","thinking":"private","signature":"opaque"},{"type":"tool_use","id":"a","name":"f","input":{}},{"type":"text","text":"unplayed"}]),
            ),
            (
                "googleParts",
                json!([{"thought":true,"text":"private"},{"functionCall":{"id":"a","name":"f","args":{}},"thoughtSignature":"opaque"},{"text":"unplayed"}]),
            ),
        ] {
            let mut message = Message::assistant("unplayed");
            message.meta = Some(json!({key:raw}));
            replace_visible_text(&mut message, "heard").unwrap();
            let serialized = message.meta.unwrap().to_string();
            assert!(serialized.contains("opaque"));
            assert!(serialized.contains("heard"));
            assert!(!serialized.contains("unplayed"));
        }
    }
    #[test]
    fn signed_text_is_rejected_without_mutating_history() {
        let mut message = Message::assistant("signed");
        message.meta = Some(json!({"googleParts":[{"text":"signed","thoughtSignature":"opaque"}]}));
        let original = message.clone();
        assert!(replace_visible_text(&mut message, "").is_err());
        assert_eq!(message, original);
    }
    #[test]
    fn segmentation_waits_for_whole_words_on_timer_and_length_limit() {
        let text = "This is a complete opening phrase and you look contempl";
        let end = segment_end(text, SegmentTrigger::Timer);
        assert_eq!(
            &text[..end],
            "This is a complete opening phrase and you look "
        );
        assert_eq!(segment_end("contempl", SegmentTrigger::Timer), 0);
        assert_eq!(
            segment_end("contemplative.", SegmentTrigger::Finished),
            "contemplative.".len()
        );
        let long = format!("{}contemplative", "word ".repeat(31));
        let end = segment_end(&long, SegmentTrigger::Update);
        assert_eq!(&long[end..], "contemplative");
        let token = "x".repeat(300);
        assert_eq!(segment_end(&token, SegmentTrigger::Timer), 0);
        assert_eq!(segment_end(&token, SegmentTrigger::Finished), token.len());
    }
    #[test]
    fn segmentation_preserves_decimals_contractions_and_unicode() {
        assert_eq!(
            segment_end("你好。再见", SegmentTrigger::Update),
            "你好。".len()
        );
        assert_eq!(segment_end("It costs 3.", SegmentTrigger::Update), 0);
        assert_eq!(
            segment_end("It costs 3.14. Next", SegmentTrigger::Update),
            "It costs 3.14.".len()
        );
        assert_eq!(segment_end("It's thought-provok", SegmentTrigger::Timer), 0);
        let text = "界".repeat(300);
        assert_eq!(segment_end(&text, SegmentTrigger::Finished), text.len());
    }
}
