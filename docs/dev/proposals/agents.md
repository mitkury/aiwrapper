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

  * Each concrete agent documents when `run(...)` resolves (e.g., **on finish** vs **immediately**). This allows both one-off and long-running behaviors under the same API.

---

## 2) Use Cases

* **Quick, one-off tasks**: web search, summarization, title generation.
* **Conversational chat**: append assistant replies to a thread of messages.
* **Monitoring/automation**: background agents like security checks, inbox triage, or periodic data fetchers.

---

## 3) Developer-Facing API

### Core concepts

* **`input(data)`**: provide validated input to the agent.
* **`run(data?)`**: execute or start the agent. Developers may pass input directly into `run`, or call `input(...)` before. The promise returned by `run` can be resolved either when the agent produces a result or immediately, depending on agent design.
* **`subscribe(listener)`**: attach a listener to all agent events (results, errors, state changes, etc.). Returns an `unsubscribe` function.

### Example: One-off agent (WebSearch)

````ts
const webSearch = new WebSearchAgent({ modelAccess: {} });

const unsubscribe = webSearch.subscribe(event => {
  if (event.type === "finished") {
    console.log("Search result:", event.output);
  }
  if (event.type === "error") {
    console.error("Search failed:", event.error);
  }
});

// Option A: provide input via run(...)
await webSearch.run({
  query: "What is the weather like in Boston?",
  context: "Planning a walking trip."
});

// Option B: provide input first, then run()
// webSearch.input({ query: "..." });
// await webSearch.run();

unsubscribe();
```ts
const webSearch = new WebSearchAgent({ modelAccess: {} });

const unsubscribe = webSearch.subscribe(event => {
  if (event.type === "finished") {
    console.log("Search result:", event.output);
  }
  if (event.type === "error") {
    console.error("Search failed:", event.error);
  }
});

await webSearch.run({
  query: "What is the weather like in Boston?",
  context: "Planning a walking trip."
});

unsubscribe();
````

### Example: Long-running agent (Security monitor)

````ts
const security = new SecurityAgent({ store: inMemoryStore() }, { pollIntervalMs: 10_000 });

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
});

// Start the agent. This agent's `run()` resolves immediately (fire-and-run),
// while the process continues to emit events. See agent docs for resolve policy.
await security.run();

// You can push inputs while it's running:
security.input({ service: "service_1", key: "key_1" });
security.input({ service: "service_2", key: "key_2" });

// When you're done, unsubscribe (the agent may stop itself based on its own logic)
unsubscribe();
```ts
const security = new SecurityAgent({ store: inMemoryStore() }, { pollIntervalMs: 10_000 });

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
});

await security.run({ service: "service_1", key: "key_1" });

// agent keeps running, can accept more input later
security.input({ service: "service_2", key: "key_2" });

// later, depending on design, developer may stop it or let it run indefinitely
unsubscribe();
````

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

````ts
class MyAgent extends Agent<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  constructor(deps, options?) {
    super(deps, { resolvePolicy: "on-finish", ...options }, { input: InputSchema, output: OutputSchema });
    // resolvePolicy examples: "on-finish" | "immediate"
  }

  protected async runOnce(input) {
    // implement one-off logic
    return `Result for query: ${input.query}`;
  }

  protected async onTick({ nextInput }) {
    // implement daemon tick (optional). If present, the agent can run indefinitely
    // until its own stopping condition. It can still emit `finished` for units of work.
  }
}
```ts
class MyAgent extends Agent<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  constructor(deps, options?) {
    super(deps, { ...options }, { input: InputSchema, output: OutputSchema });
  }

  protected async runOnce(input) {
    // implement logic
    return `Result for query: ${input.query}`;
  }

  protected async onTick({ nextInput }) {
    // used for long-running agents
  }
}
````

### Step 3. Use it

````ts
const a = new MyAgent({});
const unsub = a.subscribe(e => console.log(e));

// Either pass input via run(...)
await a.run({ query: "hello" });

// Or pre-supply input, then run()
// a.input({ query: "hello" });
// await a.run();

unsub();
```ts
const a = new MyAgent({});
const unsub = a.subscribe(e => console.log(e));
await a.run({ query: "hello" });
unsub();
````

---

## 5) Checklist for New Agents

1. Define **InputSchema** and **OutputSchema** with Zod.
2. Extend `Agent<Input, Output>` and provide schemas to `super`.
3. Decide and document your **resolve policy** for `run(input?)`:

   * `on-finish`: promise resolves when the agent finishes a unit of work.
   * `immediate`: promise resolves immediately; the agent continues emitting events.
4. Implement:

   * `runOnce(input)` for one-off work, and/or
   * `onTick({ nextInput? })` for continuous/periodic work.
5. Emit results via `finished` events and errors via `error` events.
6. (Optional) Manage state with an injected store and any checkpointing you need.

---
