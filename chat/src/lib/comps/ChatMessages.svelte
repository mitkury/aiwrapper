<script lang="ts">
	import type { LangMessage } from "aiwrapper";
  import { Markdown } from '@markpage/svelte';

  const { messages }: { messages: LangMessage[] } = $props();
</script>

<div class="space-y-3">
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