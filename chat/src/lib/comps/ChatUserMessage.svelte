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

</script>

<div class="flex justify-end">
  <div class="chat-message max-w-[75%] rounded-2xl bg-blue-50 text-blue-950 px-3 py-2 shadow-sm">
    <Markdown source={text} />
  </div>
</div>