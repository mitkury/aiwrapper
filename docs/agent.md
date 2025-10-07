# Agents

Agents let you build conversational AI, task automation, and monitoring systems. They handle message history, emit events, and can use tools.

---

## What You Can Build

* **Chat interfaces**: conversational bots with memory and tool calling
* **Task automation**: web search, summarization, content generation
* **Monitoring systems**: security checks, inbox triage, periodic data fetchers
* **Multi-step workflows**: coordinate multiple LLM calls or tools

---

## Core API

### Methods

* **`run(input?)`**: execute the agent with optional input. Returns output or void for long-running agents.
* **`input(data)`**: provide input to the agent without running it immediately
* **`subscribe(listener)`**: attach a listener to agent events. Returns an `unsubscribe` function
* **`state`**: read-only property showing current agent state (`"idle" | "running"`)

### Event Types

* **`finished`**: agent completed with output
* **`error`**: agent encountered an error
* **`state`**: agent state changed (idle/running)
* **`input`**: new input was received
* **Custom events**: agents can define their own event types

---

## Example: ChatAgent

The `ChatAgent` is a conversational agent with memory and tool support.

```typescript
import { Lang, ChatAgent } from 'aiwrapper';

const lang = Lang.openai({ apiKey: "YOUR_KEY" });
const agent = new ChatAgent(lang);

// Simple usage - run with input
const result = await agent.run({
  role: 'user',
  content: 'What is 2+2?'
});

console.log(result.answer); // "4"
console.log(result.messages); // Full conversation history
```

### Conversation Flow

```typescript
// Start conversation
agent.input({ role: 'user', content: 'My name is Alice.' });
const result1 = await agent.run();

// Continue conversation
const result2 = await agent.run({
  role: 'user',
  content: 'What is my name?'
});

console.log(result2.answer); // "Alice"

// Access conversation history
const history = agent.getConversation();
```

### Event Subscription

```typescript
const agent = new ChatAgent(lang);

const unsubscribe = agent.subscribe(event => {
  if (event.type === 'finished') {
    console.log('Done:', event.output);
  }
  if (event.type === 'error') {
    console.error('Error:', event.error);
  }
  if (event.type === 'state') {
    console.log('State:', event.state);
  }
  if (event.type === 'input') {
    console.log('Input received:', event.input);
  }
});

await agent.run({ role: 'user', content: 'Hello!' });

unsubscribe();
```

### Tools

```typescript
const agent = new ChatAgent(lang, {
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' }
        }
      },
      handler: (args) => {
        return { temp: 72, condition: 'sunny' };
      }
    }
  ]
});

const result = await agent.run({
  role: 'user',
  content: 'What is the weather in Boston?'
});

// Agent automatically calls tool and incorporates result
```

---

## Building Custom Agents

### Step 1: Define TypeScript Types

```typescript
type WebSearchInput = {
  query: string;
  context?: string;
};

type WebSearchOutput = {
  results: string[];
  query: string;
};
```

### Step 2: Extend the Agent Class

```typescript
import { Agent } from 'aiwrapper';

class WebSearchAgent extends Agent<WebSearchInput, WebSearchOutput> {
  constructor() {
    super();
  }

  protected async runInternal(input: WebSearchInput): Promise<WebSearchOutput> {
    // Implement your logic
    const results = await performSearch(input.query);
    
    const output = {
      results,
      query: input.query
    };
    
    // Emit finished event
    this.emit({ type: 'finished', output });
    
    return output;
  }

  // Optional: handle input processing
  protected inputInternal(input: WebSearchInput): void {
    console.log('Processing query:', input.query);
  }
}
```

### Step 3: Use It

```typescript
const search = new WebSearchAgent();

const unsubscribe = search.subscribe(event => {
  console.log(event);
});

// Option A: pass input to run()
const result = await search.run({
  query: 'What is TypeScript?',
  context: 'programming'
});

// Option B: provide input first, then run()
search.input({ query: 'What is TypeScript?' });
await search.run();

unsubscribe();
```

---

## Custom Events

Agents can define custom event types for domain-specific events.

```typescript
type VideoEvents = 
  | { type: 'video_chunk'; data: { chunk: Uint8Array; progress: number } }
  | { type: 'video_complete'; data: { url: string } };

class VideoAgent extends Agent<{ prompt: string }, string, VideoEvents> {
  protected async runInternal(input: { prompt: string }): Promise<string> {
    // Emit custom events during processing
    this.emit({
      type: 'video_chunk',
      data: { chunk: new Uint8Array(), progress: 0.5 }
    });
    
    this.emit({
      type: 'video_chunk',
      data: { chunk: new Uint8Array(), progress: 1.0 }
    });
    
    const result = 'video.mp4';
    this.emit({ type: 'finished', output: result });
    
    return result;
  }
}

// Usage
const video = new VideoAgent();

video.subscribe(event => {
  if (event.type === 'video_chunk') {
    console.log(`Progress: ${event.data.progress * 100}%`);
  }
  if (event.type === 'video_complete') {
    console.log('Video ready:', event.data.url);
  }
});

await video.run({ prompt: 'Generate video' });
```

---

## Long-Running Agents

For agents that run indefinitely and accept inputs over time, return `void` from `runInternal`:

```typescript
type SecurityInput = {
  service: string;
  key: string;
};

type SecurityOutput = {
  incidents: string[];
};

type SecurityEvents = 
  | { type: 'scan_progress'; data: { percentage: number } }
  | { type: 'incident_detected'; data: { severity: string; details: string } };

class SecurityAgent extends Agent<SecurityInput, SecurityOutput, SecurityEvents> {
  private queue: SecurityInput[] = [];

  protected async runInternal(input: SecurityInput): Promise<void> {
    // Long-running loop
    while (true) {
      // Emit progress
      this.emit({
        type: 'scan_progress',
        data: { percentage: 50 }
      });
      
      // Check for incidents
      const incident = await checkSecurity(input);
      if (incident) {
        this.emit({
          type: 'incident_detected',
          data: { severity: 'high', details: incident }
        });
      }
      
      await sleep(1000);
    }
  }

  protected inputInternal(input: SecurityInput): void {
    // Queue up new inputs while running
    this.queue.push(input);
  }
}

// Usage
const security = new SecurityAgent();

security.subscribe(event => {
  if (event.type === 'incident_detected') {
    console.log(`[${event.data.severity}] ${event.data.details}`);
  }
});

// Start in background
security.run({ service: 'api', key: 'key1' });

// Push more inputs while running
security.input({ service: 'db', key: 'key2' });
```

---

## Checklist for New Agents

1. Define **InputType** and **OutputType** with TypeScript
2. Extend `Agent<Input, Output, CustomEvents?>`
3. Implement `runInternal(input)`:
   - Return `TOutput` for one-off tasks
   - Return `void` for long-running agents
4. (Optional) Implement `inputInternal(input)` for immediate input processing
5. (Optional) Define custom event types
6. Emit `finished` events with output
7. Handle errors and emit `error` events
8. Use `this.emit()` for custom events during processing

---

## Key Features

* **Type Safety**: Full TypeScript support with compile-time validation
* **Event-Driven**: Subscribe to agent events (finished, error, state, input, custom)
* **Flexible Execution**: One-off or long-running agent patterns
* **State Management**: Built-in idle/running state tracking
* **Extensible Events**: Define custom event types for domain-specific needs
* **Input Processing**: Optional immediate input handling via `inputInternal`
* **Simple Setup**: No complex schema definitions needed

