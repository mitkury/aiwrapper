<script lang="ts">
  import { Lang, LangMessage, ChatAgent, type LangTool, LangMessages } from "aiwrapper";
	import ChatInput from "./ChatInput.svelte";
	import ChatMessages from "./ChatMessages.svelte";
  import ChatMessagesJson from "./ChatMessagesJson.svelte";
	import SecretsSetup from "./SecretsSetup.svelte";
	import Button from "./Button.svelte";
	import ErrorDisplay from "./ErrorDisplay.svelte";
	import { onMount } from "svelte";
  import { getSecrets } from "$lib/secretsContext.svelte";
  import {
    clearStoredMessages,
    ensurePersistentStorage,
    loadStoredMessages,
    saveStoredMessages,
    type StoredMessage
  } from "$lib/storage/messages-store";

  const tools: LangTool[] = $state([
    { name: "web_search" },
    { name: "image_generation" }
  ]);

  const agent = new ChatAgent();
  agent.messages.availableTools = tools;
  let agentIsRunning = $state(false);
  let messages: LangMessage[] = $state([]);
  type Mode = "chat" | "inspect" | "json";
  let mode: Mode = $state("chat");
  let error: Error | unknown | undefined = $state(undefined);
  let abortController: AbortController | null = null;

  const modeOptions: { id: Mode; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "inspect", label: "Inspect" },
    { id: "json", label: "JSON" }
  ];

  const waitForResponse = $derived.by(() => { 
    if (messages.length === 0) return false;
    
    // We assume that we need to wait for a resonse either if the last message
    // belongs to the user or if the agent is running
    return agentIsRunning || messages[messages.length - 1].role === "user";
  });

  let tryAgain = $state(false);

  onMount(() => { 
    const sub = agent.subscribe((event) => {
      if (event.type === "state") {
        agentIsRunning = event.state === "running";
      }

      if (event.type === "error") {
        error = event.error;
      }

      syncMessagesFromAgent();

      if (event.type === "state" && event.state === "idle") {
        void persistMessages();
      }
    });

    void initializeStorage();

    return () => sub();
  });

  const secrets = getSecrets();

  $effect(() => {
    const key = secrets?.values.OPENAI_API_SECRET;
    if (key) {
      agent.setLanguageProvider(Lang.openai({ apiKey: key, model: "gpt-5", reasoningEffort: "high", showReasoningSummary: true }));
    }
  });

  async function handleSubmit(message: string) {
    error = undefined; // Clear any previous error
    agent.messages.addUserMessage(message);
    abortController?.abort();
    abortController = new AbortController();
    
    try {
      await agent.run(undefined, { signal: abortController.signal });
    } catch (err) {
      console.error("Error running agent", err);
      error = err;
    } finally {
      abortController = null;
    }
  }

  async function handleClear() {
    abortController?.abort();
    abortController = null;
    agent.messages.splice(0, agent.messages.length);
    agent.messages.availableTools = tools;
    messages = [];
    agentIsRunning = false;
    mode = "chat";
    error = undefined;

    await clearStoredMessages();
  }

  async function handleTryAgain() {
    tryAgain = false;
    error = undefined; // Clear error when retrying
    abortController?.abort();
    abortController = new AbortController();
    try {
      await agent.run(undefined, { signal: abortController.signal });
    } catch (err) {
      console.error("Error running agent", err);
      error = err;
    } finally {
      abortController = null;
    }
  }

  function handleDismissError() {
    error = undefined;
  }

  function handleStop() {
    abortController?.abort();
  }

  function setMode(nextMode: Mode) {
    mode = nextMode;
  }

  function syncMessagesFromAgent() {
    messages = [];

    for (let i = 0; i < agent.messages.length; i++) {
      const current = agent.messages[i];
      messages.push(new LangMessage(current.role, current.items, current.meta));
    }
  }

  function cloneValue<T>(value: T): T {
    if (value === undefined || value === null) {
      return value;
    }

    const cloner = (globalThis as typeof globalThis & { structuredClone?: typeof structuredClone }).structuredClone;
    if (typeof cloner === "function") {
      try {
        return cloner(value);
      } catch (error) {
        console.warn("Structured clone failed, falling back to JSON clone", error);
      }
    }

    return JSON.parse(JSON.stringify(value)) as T;
  }

  async function persistMessages() {
    const storedMessages = agent.messages.map(
      (message): StoredMessage => ({
        role: message.role,
        items: cloneValue(message.items),
        meta: message.meta ? cloneValue(message.meta) : undefined
      })
    );

    const success = await saveStoredMessages(storedMessages);
    if (!success) {
      console.warn("Messages were not saved to IndexedDB");
    }
  }

  async function hydrateMessagesFromStorage() {
    const storedMessages = await loadStoredMessages();
    if (!storedMessages || storedMessages.length === 0) {
      return;
    }

    agent.messages = new LangMessages(storedMessages);
    agent.messages.availableTools = tools;
    syncMessagesFromAgent();
  }

  async function initializeStorage() {
    await ensurePersistentStorage();
    await hydrateMessagesFromStorage();

    if (agent.state === "idle" && waitForResponse) {
      tryAgain = true;
    }
  }
</script>

<div class="min-h-screen text-neutral-900 flex flex-col">
  <div class="mx-auto w-full max-w-3xl flex-1 flex flex-col px-4">
    <div class="sticky top-0 z-10 flex items-center gap-2 bg-white py-2">
      <div class="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 p-1">
        {#each modeOptions as option}
          <button
            type="button"
            onclick={() => setMode(option.id)}
            class={`rounded-full px-3 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 ${
              mode === option.id
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <SecretsSetup />
      <Button onclick={handleClear} disabled={messages.length === 0 && !agentIsRunning}>
        Clear Chat
      </Button>
    </div>
    <div class="flex-1 overflow-y-auto py-4 sm:py-6">
      {#if mode === "json"}
        <ChatMessagesJson {messages} />
      {:else}
        <ChatMessages messages={messages} mode={mode === "inspect" ? "inspect" : "chat"} />
      {/if}
      {#if error}
        <div class="mt-4">
          <ErrorDisplay error={error} onDismiss={handleDismissError} />
        </div>
      {/if}
      {#if tryAgain}
        <button
          onclick={handleTryAgain}
          class="bg-neutral-900 text-white rounded px-4 py-2 font-medium hover:bg-neutral-800"
        >
          Try Again
        </button>
      {/if}
    </div>

    <div class="py-3 border-neutral-200 sticky bottom-0 bg-white">
      <ChatInput
        onsubmit={handleSubmit}
        waitForResponse={waitForResponse}
        isRunning={agentIsRunning}
        onstop={handleStop}
      />
    </div>
  </div>
</div>
