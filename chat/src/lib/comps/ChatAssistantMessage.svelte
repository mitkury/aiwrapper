<script lang="ts">
	import { Markdown } from "@markpage/svelte";
	import { type LangMessage } from "aiwrapper";
	import { Image as ImageIcon } from "lucide-svelte";

  const { message }: { message: LangMessage } = $props();

  const text = $derived.by(() => {
    const textItems = message.items.filter(item => item.type === 'text');
    return textItems.map(item => item.text).join("\n\n");
  });

  const images = $derived.by(() => {
    const imgs: { src: string | undefined, alt: string | undefined }[] = [];
    for (const item of message.items) {
      if (item.type === "image") {
        let src = item.url;

        if (!src && item.base64) {
          src = `data:${item.mimeType};base64,${item.base64}`;
        }

        const alt = item.metadata?.revisedPrompt as string | undefined;

        imgs.push({
          src,
          alt
        });
      }
    }

    return imgs;
  });
</script>

<div class="flex justify-start">
  <div class="chat-message max-w-[75%] text-neutral-800">
    <Markdown source={text} />
    {#if images.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each images as image}
          {#if image.src}
            <img src={image.src} alt={image.alt} class="chat-image object-cover rounded-md" />
          {:else}
            <div class="chat-image flex items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50 text-neutral-400 animate-pulse" role="img" aria-label="Image is generating">
              <ImageIcon class="h-12 w-12" strokeWidth={1.5} aria-hidden="true" />
            </div>
          {/if}
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