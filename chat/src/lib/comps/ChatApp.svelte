<script lang="ts">
  import { Lang, LangMessage, ChatAgent, LanguageProvider, type LangTool, LangMessages } from "aiwrapper";
	import ChatInput from "./ChatInput.svelte";
	import ChatMessages from "./ChatMessages.svelte";
	import SecretsSetup from "./SecretsSetup.svelte";
	import Button from "./Button.svelte";
	import { onMount } from "svelte";
  import { getSecrets } from "$lib/secretsContext.svelte";

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

      messages = [];

      for (let i = 0; i < agent.messages.length; i++) {
        messages.push(new LangMessage(agent.messages[i].role, agent.messages[i].text, agent.messages[i].meta));
      }

      if (event.type === "state" && event.state === "idle") {
        saveMessages();
      }
    });

    loadMessages();

    if (agent.state === "idle" && waitForResponse) {
      tryAgain = true;
    }

    return () => sub();
  });

  const secrets = getSecrets();

  $effect(() => {
    const key = secrets?.values.OPENAI_API_SECRET;
    if (key) {
      agent.setLanguageProvider(Lang.openai({ apiKey: key, model: "gpt-4o" }));
    }
  });

  async function handleSubmit(message: string) {
    agent.messages.addUserMessage(message);
    
    // We run the agent with the latest message from the user
    await agent.run();
  }

  function handleClear() {
    console.log("handleClear");
    agent.messages.splice(0, agent.messages.length);
    agent.messages.availableTools = tools;
    messages = [];
    agentIsRunning = false;
    mode = "chat";

    saveMessages();
  }

  function handleTryAgain() {
    tryAgain = false;
    agent.run();
  }

  function setMode(nextMode: Mode) {
    mode = nextMode;
  }

  function saveMessages() {
    const messagesJson = JSON.stringify(agent.messages);
    localStorage.setItem("messages", messagesJson);
  }

  function loadMessages() {
    const messagesJson = localStorage.getItem("messages");
    if (messagesJson) {
      const loadedMessages = JSON.parse(messagesJson) as LangMessage[];
      agent.messages = new LangMessages(loadedMessages);
      agent.messages.availableTools = tools;
      messages = [...agent.messages];
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
      <ChatMessages messages={messages} mode={mode} />
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
      <ChatInput onsubmit={handleSubmit} waitForResponse={waitForResponse} />
    </div>
  </div>
</div>