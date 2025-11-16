<script lang="ts">
	import type { LangMessage } from "aiwrapper";
	import MessageInspector from "./MessageInspector.svelte";
	import ChatUserMessage from "./ChatUserMessage.svelte";
	import ChatAssistantMessage from "./ChatAssistantMessage.svelte";

type Mode = "chat" | "inspect" | "json";

const {
  messages,
  mode = "chat"
}: {
  messages: LangMessage[];
  mode?: Mode;
} = $props();

const formattedMessages = $derived.by(() => {
  if (mode !== "json") return "";

  const json = JSON.stringify(
    messages.map((message) => ({
      role: message.role,
      ...(message.meta ? { meta: message.meta } : {}),
      ...(message.text ? { text: message.text } : {}),
      ...(message.toolRequests?.length ? { toolRequests: message.toolRequests } : {}),
      ...(message.toolResults?.length ? { toolResults: message.toolResults } : {}),
      ...(message.images?.length
        ? {
            images: message.images.map((image) => ({
              ...image,
              base64: image.base64
                ? image.base64.slice(0, 10) + "..." + image.base64.slice(image.base64.length - 10, image.base64.length)
                : ""
            }))
          }
        : {})
    })),
    null,
    2
  );

  return json;
});
</script>

<div class="space-y-3">
  {#if mode === "json"}
    <pre class="overflow-x-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800">{formattedMessages}</pre>
  {:else if mode === "inspect"}
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