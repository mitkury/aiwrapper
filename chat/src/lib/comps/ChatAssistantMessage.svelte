<script lang="ts">
	import { Markdown } from "@markpage/svelte";
	import type { LangMessage } from "aiwrapper";

  const { message }: { message: LangMessage } = $props();

  const text = $derived.by(() => {
    if (message.content instanceof String) {
      return message.content as string;
    }

    return message.text;
  });

  const images = $derived.by(() => { 
    return message.images.map((image) => {
      let url = image.url;
      if (!url && image.base64) {
        url = `data:${image.mimeType ?? "image/png"};base64,${image.base64}`;
      }
      return {
        url,
        alt: image.metadata?.prompt ?? ""
      };
    });
  });
</script>

<div class="flex justify-start">
  <div class="chat-message max-w-[75%] text-neutral-800">
    <Markdown source={text} />
    {#if images.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each images as image}
          <img src={image.url ?? ""} alt={image.alt ?? ""} class="chat-image object-cover rounded-md" />
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