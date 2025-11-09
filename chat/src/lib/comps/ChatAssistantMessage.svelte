<script lang="ts">
	import { Markdown } from "@markpage/svelte";
	import { type LangMessage } from "aiwrapper";

  const { message }: { message: LangMessage } = $props();

  const text = $derived.by(() => {
    return message.items.filter(item => item.type === 'text');
  });

  const images = $derived.by(() => { 
    return message.items.filter(item => item.type === 'image');
  });
</script>

<div class="flex justify-start">
  <div class="chat-message max-w-[75%] text-neutral-800">
    <Markdown source={text.map(item => item.text).join("\n\n")} />
    {#if images.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each images as image}
          <img src={image.url ? image.url : `data:${image.mimeType ?? "image/png"};base64,${image.base64}`} alt={""} class="chat-image object-cover rounded-md" />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .chat-image {
    width: 256px;
    height: 256px;
  }
</style>