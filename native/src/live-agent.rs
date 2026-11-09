//! Tool orchestration over a live session. One bounded, ordered tool queue runs
//! separately from the receiver. Hosts choose when to reconnect and own media.
use super::*;
use crate::{Tool, ToolContext, agent::validate_tools};
use futures_util::future::BoxFuture;
use tokio::{sync::mpsc, task::JoinHandle};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveToolCall {
    pub generation: u64,
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
}
pub type LiveCallWriter = Arc<dyn Fn(LiveToolCall) -> BoxFuture<'static, Result<()>> + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LiveToolStatus {
    Success,
    Error,
    Cancelled,
}

/// Execution status is independent of result JSON and delivery. A successful
/// handler may return an `error` field as data, or finish after cancellation.
#[derive(Clone, Debug, Serialize)]
pub struct LiveToolOutcome {
    pub generation: u64,
    pub result: LiveToolResult,
    pub status: LiveToolStatus,
}
pub type LiveResultWriter =
    Arc<dyn Fn(LiveToolOutcome) -> BoxFuture<'static, Result<()>> + Send + Sync>;

pub struct LiveAgentOptions {
    pub max_pending_tools: usize,
    pub max_argument_bytes: usize,
    pub max_result_bytes: usize,
    /// Record each accepted call before validation/execution, on the tool worker.
    /// A failure prevents this and subsequent handlers from running.
    pub on_tool_call: Option<LiveCallWriter>,
    /// Persist the actual outcome before submitting it. Runs even after
    /// cancellation: a handler that started may already have changed the world.
    pub on_tool_result: Option<LiveResultWriter>,
}
impl Default for LiveAgentOptions {
    fn default() -> Self {
        Self {
            max_pending_tools: 32,
            max_argument_bytes: 256 * 1024,
            max_result_bytes: 1024 * 1024,
            on_tool_call: None,
            on_tool_result: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum LiveAgentEvent {
    Model {
        event: LiveEvent,
    },
    ToolResult {
        generation: u64,
        result: LiveToolResult,
        status: LiveToolStatus,
    },
    ToolDeliveryFailed {
        generation: u64,
        call_id: String,
        error: String,
    },
}

struct Route {
    sender: LiveSender,
    generation: u64,
    unsent: BTreeMap<String, LiveToolResult>,
}
struct Work {
    tool: Option<Tool>,
    context: ToolContext,
    arguments: Value,
    generation: u64,
}

/// One agent per logical conversation, including connection replacements.
/// Keep polling `next_events` during tools. A matching resumption keeps pending
/// work; a fresh connection cancels it and starts a new call-id namespace.
pub struct LiveAgent {
    session: LiveSession,
    tools: BTreeMap<String, Tool>,
    route: Arc<Mutex<Route>>,
    requests: Option<mpsc::Sender<Work>>,
    results: mpsc::Receiver<Result<Vec<LiveAgentEvent>>>,
    worker: Option<JoinHandle<Result<()>>>,
    retry: Arc<Notify>,
    pending: BTreeMap<(u64, String), CancellationToken>,
    seen: HashSet<String>,
    max_pending: usize,
    max_argument_bytes: usize,
    cancellation: CancellationToken,
    connected: bool,
    generation: u64,
}
impl LiveAgent {
    pub fn new(session: LiveSession, tools: Vec<Tool>, options: LiveAgentOptions) -> Result<Self> {
        validate_tools(&tools)?;
        if options.max_pending_tools == 0
            || options.max_argument_bytes == 0
            || options.max_result_bytes == 0
        {
            return Err(Error::Invalid("invalid live agent tool limits".into()));
        }
        let (requests, queue) = mpsc::channel(options.max_pending_tools);
        let (output, results) = mpsc::channel(options.max_pending_tools);
        let route = Arc::new(Mutex::new(Route {
            sender: session.sender.clone(),
            generation: 0,
            unsent: BTreeMap::new(),
        }));
        let retry = Arc::new(Notify::new());
        let cancellation = CancellationToken::new();
        let max_pending = options.max_pending_tools;
        let max_argument_bytes = options.max_argument_bytes;
        let worker = tokio::spawn(run_tools(
            queue,
            output,
            route.clone(),
            retry.clone(),
            cancellation.clone(),
            options,
        ));
        Ok(Self {
            session,
            tools: tools
                .into_iter()
                .map(|t| (t.definition.name.clone(), t))
                .collect(),
            route,
            requests: Some(requests),
            results,
            worker: Some(worker),
            retry,
            pending: BTreeMap::new(),
            seen: HashSet::new(),
            max_pending,
            max_argument_bytes,
            cancellation,
            connected: true,
            generation: 0,
        })
    }

    pub fn sender(&self) -> LiveSender {
        self.session.sender.clone()
    }

    /// Provider item IDs belong to this generation. Matching resumption keeps
    /// it; replacement with a fresh session advances it.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// An executor/persistence failure permanently stops this agent. A provider
    /// disconnect alone does not: it can be replaced while tools finish.
    pub fn is_stopped(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    /// Includes work from retired generations until its outcome is collected.
    pub fn pending_tool_count(&self) -> usize {
        self.pending.len()
    }

    pub async fn next_events(&mut self) -> Result<Option<Vec<LiveAgentEvent>>> {
        enum Ready {
            Model(Result<Option<Vec<LiveEvent>>>),
            Tool(Option<Result<Vec<LiveAgentEvent>>>),
        }
        if !self.connected && self.pending.is_empty() {
            return Ok(None);
        }
        let ready = tokio::select! {
            events = self.session.receiver.next_events(), if self.connected => Ready::Model(events),
            result = self.results.recv() => Ready::Tool(result),
        };
        match ready {
            Ready::Model(Ok(Some(events))) => self.accept_model_events(events).map(Some),
            Ready::Model(Ok(None)) => {
                self.connected = false;
                // Report the lost connection immediately, even with a slow
                // tool pending. Hosts need this event to begin recovery.
                Ok(Some(vec![LiveAgentEvent::Model {
                    event: LiveEvent::Closed {
                        code: None,
                        reason: None,
                    },
                }]))
            }
            Ready::Model(Err(error)) => {
                self.connected = false;
                Err(error)
            }
            Ready::Tool(Some(result)) => {
                let events = result?;
                for event in &events {
                    if let LiveAgentEvent::ToolResult {
                        generation, result, ..
                    } = event
                    {
                        self.pending.remove(&(*generation, result.call_id.clone()));
                    }
                }
                Ok(Some(events))
            }
            Ready::Tool(None) => Err(Error::Protocol("live tool executor closed".into())),
        }
    }

    fn accept_model_events(&mut self, events: Vec<LiveEvent>) -> Result<Vec<LiveAgentEvent>> {
        for event in &events {
            match event {
                LiveEvent::ToolCall {
                    call_id,
                    name,
                    arguments,
                } => self.start_tool(call_id, name, arguments)?,
                LiveEvent::ToolsCancelled { call_ids } => {
                    for id in call_ids {
                        if let Some(token) = self.pending.get(&(self.generation, id.clone())) {
                            token.cancel();
                        }
                    }
                }
                LiveEvent::Closed { .. } => self.connected = false,
                _ => {}
            }
        }
        Ok(events
            .into_iter()
            .map(|event| LiveAgentEvent::Model { event })
            .collect())
    }

    fn start_tool(&mut self, id: &str, name: &str, arguments: &Value) -> Result<()> {
        crate::error::check_cancel(&self.cancellation)?;
        if serde_json::to_vec(&(name, arguments))?.len() > self.max_argument_bytes {
            return Err(Error::Protocol(
                "live tool arguments exceed the queue budget".into(),
            ));
        }
        if self.seen.contains(id) {
            return Err(Error::Protocol(
                "tool id already belongs to an earlier connection".into(),
            ));
        }
        if self.pending.len() >= self.max_pending || self.seen.len() >= 16_384 {
            return Err(Error::Protocol("live agent tool capacity reached".into()));
        }
        let cancellation = self.cancellation.child_token();
        let context = ToolContext {
            call_id: id.into(),
            name: name.into(),
            cancellation: cancellation.clone(),
        };
        let tool = self
            .tools
            .get(name)
            .filter(|_| {
                self.session
                    .tools
                    .iter()
                    .any(|definition| definition.name == name)
            })
            .cloned();
        self.requests
            .as_ref()
            .ok_or(Error::Cancelled)?
            .try_send(Work {
                tool,
                context,
                arguments: arguments.clone(),
                generation: self.generation,
            })
            .map_err(|_| Error::Protocol("live tool queue is full or closed".into()))?;
        self.seen.insert(id.into());
        self.pending
            .insert((self.generation, id.into()), cancellation);
        Ok(())
    }

    /// Install an already-connected replacement at an event boundary. Establish
    /// it while the old receiver is still polled. Unrelated resumptions fail
    /// before either session changes; old sender clones remain old connections.
    /// Return any final events already received from the retired connection.
    pub async fn replace(
        &mut self,
        next: LiveSession,
        tools: Vec<Tool>,
    ) -> Result<Vec<LiveAgentEvent>> {
        crate::error::check_cancel(&self.cancellation)?;
        validate_tools(&tools)?;
        // A cancelled select branch may have consumed a provider message while
        // waiting on a concurrent send. Finish it before fencing the connection.
        let received = self
            .session
            .receiver
            .drain_received()
            .await
            .unwrap_or_else(|error| {
                vec![LiveEvent::Closed {
                    code: None,
                    reason: Some(error.to_string()),
                }]
            });
        let retired = self.accept_model_events(received)?;
        let mut route = self.route.lock().await;
        let previous = self.session.sender.connection.state.lock().await;
        let resumed = match &next.sender.connection.resumed_from {
            Some(handle) if previous.resume_handle.as_ref() == Some(handle) => true,
            Some(_) => {
                return Err(Error::Invalid(
                    "replacement resumption belongs to another session".into(),
                ));
            }
            None => false,
        };
        if resumed {
            next.sender
                .connection
                .state
                .lock()
                .await
                .calls
                .extend(previous.calls.clone());
        } else {
            for token in self.pending.values() {
                token.cancel();
            }
            self.generation += 1;
            self.seen.clear();
            route.generation = self.generation;
            route.unsent.clear();
        }
        drop(previous);
        let old = std::mem::replace(&mut self.session, next);
        route.sender = self.session.sender.clone();
        self.tools = tools
            .into_iter()
            .map(|t| (t.definition.name.clone(), t))
            .collect();
        self.connected = true;
        drop(route);
        self.retry.notify_one();
        let _ = old.sender.close().await;
        Ok(retired)
    }

    pub async fn close(mut self) -> Result<()> {
        self.cancellation.cancel();
        self.requests.take();
        if let Some(processing) = self.session.receiver.processing.take() {
            processing.abort();
        }
        let closed = self.session.sender.close().await;
        if let Some(worker) = self.worker.take() {
            worker
                .await
                .map_err(|e| Error::Protocol(format!("live tool executor failed: {e}")))??;
        }
        closed
    }
}
impl Drop for LiveAgent {
    fn drop(&mut self) {
        // Detach rather than abort a handler that may already have side effects.
        // Cancellation is cooperative; its persistence hook still runs.
        self.cancellation.cancel();
    }
}

async fn run_tools(
    mut queue: mpsc::Receiver<Work>,
    output: mpsc::Sender<Result<Vec<LiveAgentEvent>>>,
    route: Arc<Mutex<Route>>,
    retry: Arc<Notify>,
    stop: CancellationToken,
    options: LiveAgentOptions,
) -> Result<()> {
    loop {
        let result = tokio::select! {
            work = queue.recv() => match work {
                Some(work) => execute(work, &route, &options).await,
                None => break,
            },
            _ = retry.notified() => retry_results(&route).await,
        };
        if let Err(error) = result {
            let _ = output.try_send(Err(Error::Protocol(error.to_string())));
            stop.cancel();
            return Err(error);
        }
        tokio::select! {
            result = output.send(result) => if result.is_err() { break; },
            _ = stop.cancelled() => {},
        }
    }
    Ok(())
}

async fn execute(
    work: Work,
    route: &Mutex<Route>,
    options: &LiveAgentOptions,
) -> Result<Vec<LiveAgentEvent>> {
    if let Some(write) = &options.on_tool_call {
        write(LiveToolCall {
            generation: work.generation,
            call_id: work.context.call_id.clone(),
            name: work.context.name.clone(),
            arguments: work.arguments.clone(),
        })
        .await?;
    }
    let outcome = match work.tool {
        Some(tool) => tool.execute(work.arguments, work.context.clone()).await,
        None => Err(Error::Tool(format!(
            "unknown or disabled tool: {}",
            work.context.name
        ))),
    };
    let status = match &outcome {
        Ok(_) => LiveToolStatus::Success,
        Err(Error::Cancelled) => LiveToolStatus::Cancelled,
        Err(_) => LiveToolStatus::Error,
    };
    let raw = LiveToolResult {
        call_id: work.context.call_id.clone(),
        name: work.context.name.clone(),
        images: vec![],
        result: match outcome {
            Ok(value) => value,
            Err(error) => {
                json!({"error":error.to_string(),"cancelled":matches!(error,Error::Cancelled)})
            }
        },
    };
    // Store full outcomes, including malformed/oversized content, before making
    // the model-facing projection. Storage never inherits the model budget.
    if let Some(write) = &options.on_tool_result {
        write(LiveToolOutcome {
            generation: work.generation,
            result: raw.clone(),
            status,
        })
        .await?;
    }
    let mut result = raw;
    if let Err(error) = split_content(&mut result) {
        result.result = json!({"error":error.to_string()});
        result.images.clear();
    }
    if serde_json::to_vec(&result)?.len() > options.max_result_bytes {
        result.result =
            json!({"error":"Tool completed, but its output exceeds the live model result budget."});
        result.images.clear();
    }
    let mut events = vec![LiveAgentEvent::ToolResult {
        generation: work.generation,
        result: result.clone(),
        status,
    }];
    let mut route = route.lock().await;
    if work.generation == route.generation
        && !work.context.cancellation.is_cancelled()
        && let Err(error) = deliver(&route.sender, &result).await
    {
        if route.unsent.len() >= options.max_pending_tools {
            return Err(Error::Protocol(
                "undelivered live tool result budget reached".into(),
            ));
        }
        route.unsent.insert(result.call_id.clone(), result.clone());
        events.push(LiveAgentEvent::ToolDeliveryFailed {
            generation: work.generation,
            call_id: result.call_id,
            error: error.to_string(),
        });
    }
    Ok(events)
}

async fn retry_results(route: &Mutex<Route>) -> Result<Vec<LiveAgentEvent>> {
    let (generation, ids) = {
        let route = route.lock().await;
        (
            route.generation,
            route.unsent.keys().cloned().collect::<Vec<_>>(),
        )
    };
    let mut events = vec![];
    for id in ids {
        let mut route = route.lock().await;
        if route.generation != generation {
            break;
        }
        let Some(result) = route.unsent.get(&id) else {
            continue;
        };
        match deliver(&route.sender, result).await {
            Ok(()) => {
                route.unsent.remove(&id);
            }
            Err(error) => events.push(LiveAgentEvent::ToolDeliveryFailed {
                generation,
                call_id: id,
                error: error.to_string(),
            }),
        }
    }
    Ok(events)
}

async fn deliver(sender: &LiveSender, result: &LiveToolResult) -> Result<()> {
    tokio::time::timeout(
        Duration::from_secs(2),
        sender.send_tool_results(std::slice::from_ref(result)),
    )
    .await
    .map_err(|_| Error::Protocol("live tool delivery timed out".into()))?
}

fn split_content(result: &mut LiveToolResult) -> Result<()> {
    if result.result["type"] != "tool-content" {
        return Ok(());
    }
    let parts = result.result["content"]
        .as_array()
        .ok_or_else(|| Error::Invalid("invalid tool content".into()))?;
    let mut text = vec![];
    for part in parts {
        match part["type"].as_str() {
            Some("text") => text.push(part["text"].as_str().unwrap_or_default()),
            Some("image") => {
                let image = LiveImage {
                    data: part["base64"].as_str().unwrap_or_default().into(),
                    mime_type: part["mimeType"].as_str().unwrap_or_default().into(),
                };
                image.validate()?;
                result.images.push(image);
            }
            _ => return Err(Error::Invalid("unsupported live tool content".into())),
        }
    }
    result.result = json!({"result":text.join("\n")});
    Ok(())
}
