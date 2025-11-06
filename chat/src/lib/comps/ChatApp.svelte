<script lang="ts">
  import { Lang, LangMessage, ChatAgent, LanguageProvider } from "aiwrapper";
	import ChatInput from "./ChatInput.svelte";
	import ChatMessages from "./ChatMessages.svelte";
	import { onMount } from "svelte";
  import { getSecrets } from "$lib/secretsContext.svelte";

  const agent = new ChatAgent();
  let agentIsRunning = $state(false);
  let messages: LangMessage[] = $state([])

  const waitForResponse = $derived.by(() => { 
    if (messages.length === 0) return false;
    
    // We assume that we need to wait for a resonse either if the last message
    // belongs to the user or if the agent is running
    return agentIsRunning || messages[messages.length - 1].role === "user";
  });

  onMount(() => { 
    const sub = agent.subscribe((event) => {
      if (event.type === "state") {
        agentIsRunning = event.state === "running";
      }

      messages = [];

      for (let i = 0; i < agent.messages.length; i++) {
        messages.push(new LangMessage(agent.messages[i].role, agent.messages[i].content, agent.messages[i].meta));
      }
    });

    return () => sub();
  });

  const secrets = getSecrets();

  $effect(() => {
    const key = secrets?.values.OPENAI_API_SECRET;
    if (key) {
      agent.setLanguageProvider(Lang.openai({ apiKey: key }));
    }
  });
  
  async function handleSubmit(message: string) {
    agent.messages.addUserMessage(message);
    
    // We run the agent with the latest message from the user
    await agent.run();
  }
</script>

<div class="min-h-screen text-neutral-900 flex flex-col">
  <div class="mx-auto w-full max-w-3xl flex-1 flex flex-col px-4">
    <div class="py-4 sm:py-6">
      <h1 class="text-lg font-semibold text-neutral-800">Chat</h1>
    </div>

    <div class="flex-1 overflow-y-auto py-4 sm:py-6">
      <ChatMessages messages={messages} />
    </div>

    <div class="py-3 border-neutral-200 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky bottom-0">
      <ChatInput onsubmit={handleSubmit} waitForResponse={waitForResponse} />
    </div>
  </div>
</div>