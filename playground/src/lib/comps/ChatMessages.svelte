<script lang="ts">
  import type { LangMessage } from "aiwrapper";
  import MessageInspector from "./MessageInspector.svelte";
  import ChatUserMessage from "./ChatUserMessage.svelte";
  import ChatAssistantMessage from "./ChatAssistantMessage.svelte";

type Mode = "chat" | "inspect";

const {
  messages,
  mode = "chat"
}: {
  messages: LangMessage[];
  mode?: Mode;
} = $props();
</script>

<div class="space-y-3">
  {#if mode === "inspect"}
    {#each messages as message}
      <MessageInspector message={message} />
    {/each}
  {:else}
    {#each messages as message}
      {#if message.role === "user"}
        <ChatUserMessage {message} />
      {:else}
        <ChatAssistantMessage {message} />
      {/if}
    {/each}
  {/if}
</div>

<style>
  :global {
    .chat-message p {
      margin: 0.5rem 0;
    }

    .chat-message h1 {
      font-size: 1.5rem !important;
      font-weight: bold;
      margin: 0.75rem 0;
    }

    .chat-message h2 {
      font-size: 1.25rem !important;
      font-weight: bold;
      margin: 0.75rem 0;
    }

    .chat-message h3 {
      font-size: 1.125rem !important;
      font-weight: 600;
      margin: 0.5rem 0;
    }

    .chat-message h4 {
      font-size: 1rem !important;
      font-weight: 600;
      margin: 0.5rem 0;
    }

    .chat-message h5 {
      font-size: 0.875rem !important;
      font-weight: 500;
      margin: 0.5rem 0;
    }

    .chat-message h6 {
      font-size: 0.875rem !important;
      font-weight: 500;
      margin: 0.5rem 0;
    }
  }
</style>
