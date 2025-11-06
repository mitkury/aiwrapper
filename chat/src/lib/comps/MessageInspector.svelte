<script lang="ts">
  import type { LangMessage, LangImageOutput, ToolRequest, ToolResult } from "aiwrapper";

  const { message }: { message: LangMessage } = $props();

  let standaloneText: string = $state("");
  let toolRequests: ToolRequest[] = $state([]);
  let toolResults: ToolResult[] = $state([]);
  let images: LangImageOutput[] = $state([]);

  const isUserMessage = $derived(message.role === "user");

  $effect(() => {
    standaloneText = message.text;
    toolRequests = message.toolRequests;
    toolResults = message.toolResults;
    images = message.images ?? [];
  });

  function getImageAlt(image: LangImageOutput): string {
    const prompt = image.metadata?.prompt;
    if (typeof prompt === "string" && prompt.trim().length > 0) {
      return prompt;
    }
    return "";
  }
</script>

<div class={`flex ${isUserMessage ? "justify-end" : "justify-start"}`}>
  <div class={isUserMessage ? "text-right" : "text-left"}>
    <span class={`block text-sm font-medium text-neutral-800 ${isUserMessage ? "ml-auto" : "mr-auto"}`}>{message.role}</span>
    {#if standaloneText && standaloneText.length > 0}
      <pre class="text-neutral-800">{standaloneText}</pre>
    {/if}
    {#if toolRequests && toolRequests.length > 0}
      <p class="text-neutral-800">Tool Requests: {toolRequests.length}</p>
    {/if}
    {#if toolResults && toolResults.length > 0}
      <p class="text-neutral-800">Tool Results: {toolResults.length}</p>
    {/if}
    {#if images.length > 0}
      <p class="text-neutral-800">Images: {images.length}</p>
      {#each images as image}
        <img
          src={image.url ?? image.base64 ?? ""}
          alt={getImageAlt(image)}
          class="w-full h-auto"
          loading="lazy"
        />
      {/each}
    {/if}
  </div>
</div>