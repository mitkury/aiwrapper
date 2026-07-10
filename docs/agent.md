# Agents

Agents add orchestration and events around language providers. `ChatAgent` is the built-in conversational agent. It keeps message history, streams updates, and continues calling the model until locally handled tools are resolved.

## ChatAgent

```ts
import { ChatAgent, Lang, LangMessage } from "aiwrapper";

const lang = Lang.openai({ apiKey: process.env.OPENAI_API_KEY });
const agent = new ChatAgent(lang);

const result = await agent.run([
  new LangMessage("user", "What is 2 + 2?"),
]);

console.log(result.answer);
console.log(agent.getMessages());
```

Each call appends its input to the agent's existing history. You can also construct and pass a `LangMessages` collection. Passing a collection replaces the agent's current history with that collection.

## Tools

Pass locally executed tools to the constructor:

```ts
const agent = new ChatAgent(lang, {
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
      },
      handler: async ({ location }) => ({ location, temperature: 22 }),
    },
  ],
});

const result = await agent.run([
  new LangMessage("user", "What is the weather in Bogotá?"),
]);
```

`ChatAgent` sends available tools to the provider, executes requested handlers, appends `tool-results` messages, and asks the provider to continue until it produces a final response.

## Events

Every agent emits state and failure events. `ChatAgent` also emits `streaming` and `finished` events.

```ts
const unsubscribe = agent.subscribe(event => {
  switch (event.type) {
    case "state":
      console.log(event.state);
      break;
    case "streaming":
      console.log(event.data.idx, event.data.msg.text);
      break;
    case "finished":
      console.log(event.output.answer);
      break;
    case "aborted":
      console.log("Aborted", event.partial?.answer);
      break;
    case "error":
      console.error(event.error);
      break;
  }
});

await agent.run([new LangMessage("user", "Hello")]);
unsubscribe();
```

Listeners should not throw. A listener error is logged and does not stop other listeners.

## Cancellation

Pass an `AbortSignal` to `run`:

```ts
const controller = new AbortController();

const pending = agent.run(
  [new LangMessage("user", "Write a long story")],
  { signal: controller.signal },
);

controller.abort();
const partial = await pending;
```

When a provider can return partial messages, `ChatAgent` emits an `aborted` event and resolves with that partial result. If no partial result exists, it rethrows the `AbortError`.

## Custom agents

Extend `Agent<Input, Output, CustomEvent>` and implement `runInternal`. State changes and failures are handled by the base class. A custom agent is responsible for emitting its own `finished` event.

```ts
import { Agent } from "aiwrapper";

type SearchInput = { query: string };
type SearchOutput = { results: string[] };
type SearchProgress = {
  type: "progress";
  data: { completed: number };
};

class SearchAgent extends Agent<SearchInput, SearchOutput, SearchProgress> {
  protected async runInternal(
    input?: SearchInput,
    options?: { signal?: AbortSignal },
  ): Promise<SearchOutput> {
    if (!input) throw new Error("Search input is required");
    options?.signal?.throwIfAborted();

    this.emit({ type: "progress", data: { completed: 0 } });
    const output = { results: await search(input.query) };
    this.emit({ type: "finished", output });
    return output;
  }
}
```

The base `Agent` represents one `run` lifecycle. If an agent needs queued or continuous input, expose that behavior explicitly in the subclass instead of relying on an `input()` method; the base class does not provide one.
