<script lang="ts">
	import { Markdown } from "@markpage/svelte";
	import { type LangMessage } from "aiwrapper";

  const { message }: { message: LangMessage } = $props();

  const text = $derived.by(() => {
    return message.items.filter(item => item.type === 'text');
  });

  const images = $derived.by(() => { 

    const imgs: { src: string, alt: string }[] = [];
    for (const item of message.items) {
      if (item.type === "image") {
        let src = item.url;

        if (!src && item.base64) {
          src = `data:${item.mimeType};base64,${item.base64}`;
        }

        const alt = item.metadata?.revisedPrompt ?? "";

        if (!src) {
          continue;
        }

        imgs.push({
          src,
          alt
        });
      }
    }

    if (imgs.length > 0) console.log("Render images: " + imgs.length);
    return imgs;
  });
</script>

<div class="flex justify-start">
  <div class="chat-message max-w-[75%] text-neutral-800">
    <Markdown source={text.map(item => item.text).join("\n\n")} />
    {#if images.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each images as image}
          <img src={image.src} alt={image.alt} class="chat-image object-cover rounded-md" />
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