<script lang="ts">
	import type { LangMessage } from "aiwrapper";
  import { Markdown } from '@markpage/svelte';
	import MessageInspector from "./MessageInspector.svelte";

const {
  messages,
  inspectionIsOn,
  jsonViewIsOn
}: {
  messages: LangMessage[];
  inspectionIsOn?: boolean;
  jsonViewIsOn?: boolean;
} = $props();

const formattedMessages = $derived.by(() =>
  JSON.stringify(
    messages.map((message) => ({
      role: message.role,
      content: message.content,
      text: message.text,
      meta: message.meta,
      toolRequests: message.toolRequests,
      toolResults: message.toolResults,
      images: message.images
    })),
    null,
    2
  )
);
</script>

<div class="space-y-3">
  {#if jsonViewIsOn}
    <pre class="overflow-x-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800">{formattedMessages}</pre>
  {:else if inspectionIsOn}
    {#each messages as message}
      <MessageInspector message={message} />
    {/each}
  {:else}
    {#each messages as message}
      {#if message.role === "user"}
        <div class="flex justify-end">
          <div class="chat-message max-w-[75%] rounded-2xl bg-blue-50 text-blue-950 px-3 py-2 shadow-sm">
            <Markdown source={message.text} />
          </div>
        </div>
      {:else}
        <div class="flex justify-start">
          <div class="chat-message max-w-[75%] text-neutral-800">
            <Markdown source={message.text} />
          </div>
        </div>
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