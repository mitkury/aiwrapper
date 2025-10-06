# Agents — Brief Spec

## 1) What is this?

A unified abstraction for **agents** that can run either:

* **One-off tasks** — execute once with a single input, produce a single output (e.g., summarization, web search).
* **Long-running agents** — keep running for hours or days, accept additional inputs dynamically, or trigger their own actions (e.g., security monitor).

Inputs and outputs are validated with **Zod** at runtime; TypeScript types are inferred from the same schemas.

---

## 2) Use Cases

* **Quick, one-off tasks**: web search, summarization, title generation.
* **Conversational chat**: append assistant replies to a thread of messages.
* **Monitoring/automation**: background agents like security checks, inbox triage, or periodic data fetchers.

---

## 3) Developer-Facing API

### Core concepts

* **`subscribe(listener)`**: attach a listener to agent events. Returns an `unsubscribe` function.
* **`input(data)`**: provide validated input to the agent at any time (before or during `run`).
* **`run(input?)`**: execute the agent. You may pass input directly here; if omitted, the agent uses the last `input(...)` provided.
* **`state`**: read-only property to check current agent state (`"idle" | "running"`).

### Event Types

* **`finished`**: agent completed a unit of work with output
* **`error`**: agent encountered an error
* **`state`**: agent state changed (idle/running)
* **`input`**: new input was received
* **Custom events**: agents can define their own event types (e.g., `video_chunk`, `progress`)

### Example: One-off agent (WebSearch)

```ts
const webSearch = new WebSearchAgent(schemas);

const unsubscribe = webSearch.subscribe(event => {
  if (event.type === "finished") {
    console.log("Search result:", event.output);
  }
  if (event.type === "error") {
    console.error("Search failed:", event.error);
  }
  if (event.type === "state") {
    console.log("Agent state:", event.state);
  }
});

// Option A: provide input via run(...) and await result
const result = await webSearch.run({
  query: "What is the weather like in Boston?",
  context: "Planning a walking trip."
});

// Option B: provide input first, then run()
// webSearch.input({ query: "..." });
// await webSearch.run();

unsubscribe();
```

### Example: Long-running agent (Security monitor)

```ts
type SecurityEvents = 
  | { type: "incident_detected"; data: { severity: string; details: string } }
  | { type: "scan_progress"; data: { percentage: number } };

const security = new SecurityAgent(schemas);

const unsubscribe = security.subscribe(event => {
  if (event.type === "finished") {
    console.log("[Incident]", event.output);
  }
  if (event.type === "error") {
    console.error("[Security error]", event.error);
  }
  if (event.type === "state") {
    console.log("[Security state]", event.state);
  }
  if (event.type === "incident_detected") {
    console.log(`[${event.data.severity}] ${event.data.details}`);
  }
  if (event.type === "scan_progress") {
    console.log(`Scan: ${event.data.percentage}%`);
  }
});

// Start the agent - returns void for long-running agents
await security.run();

// You can push inputs while it's running:
security.input({ service: "service_1", key: "key_1" });
security.input({ service: "service_2", key: "key_2" });

// Check state anytime
if (security.state === "idle") {
  security.input({ service: "service_3", key: "key_3" });
}

// When you're done, unsubscribe
unsubscribe();
```

---

## 4) How to Build Agents

### Step 1. Define input/output schemas

```ts
const InputSchema = z.object({
  query: z.string()
});
const OutputSchema = z.string();
```

### Step 2. Extend the base `Agent`

```ts
class MyAgent extends Agent<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  constructor() {
    super({ input: InputSchema, output: OutputSchema });
  }

  protected async runInternal(input) {
    // implement one-off logic
    const result = `Result for query: ${input.query}`;
    this.emit({ type: "finished", output: result });
    return result;
  }

  // Optional: handle input processing after validation
  protected inputInternal(input) {
    // Process input immediately when received
    console.log("Processing input:", input.query);
  }
}
```

### Step 3. Use it

```ts
const a = new MyAgent();
const unsub = a.subscribe(e => console.log(e));

// Either pass input via run(...)
const result = await a.run({ query: "hello" });

// Or pre-supply input, then run()
// a.input({ query: "hello" });
// await a.run();

unsub();
```

### Example: Agent with custom events

```ts
type VideoEvents = 
  | { type: "video_chunk"; data: { chunk: Uint8Array; progress: number } }
  | { type: "video_complete"; data: { url: string } };

class VideoAgent extends Agent<InputSchema, string, VideoEvents> {
  protected async runInternal(input) {
    // Emit custom events during processing
    this.emit({ type: "video_chunk", data: { chunk: new Uint8Array(), progress: 0.5 } });
    this.emit({ type: "video_chunk", data: { chunk: new Uint8Array(), progress: 1.0 } });
    
    const result = "video.mp4";
    this.emit({ type: "finished", output: result });
    return result;
  }
}
```

---

## 5) Checklist for New Agents

1. Define **InputSchema** and **OutputSchema** with Zod.
2. Extend `Agent<Input, Output, CustomEvents?>` and provide schemas to `super`.
3. Implement `runInternal(input)` - decide whether to:
   - Return `TOutput` for one-off tasks
   - Return `void` for long-running agents
4. (Optional) Implement `inputInternal(input)` for immediate input processing.
5. (Optional) Define custom event types for domain-specific events.
6. Emit results via `finished` events and errors via `error` events.
7. Use `this.emit()` to send custom events during processing.

---

## 6) Key Features

- **Type Safety**: Full TypeScript support with Zod validation
- **Event-Driven**: Subscribe to agent events (finished, error, state, input, custom)
- **Flexible Execution**: One-off or long-running agent patterns
- **State Management**: Built-in idle/running state tracking
- **Extensible Events**: Define custom event types for domain-specific needs
- **Input Processing**: Optional immediate input handling via `inputInternal`
