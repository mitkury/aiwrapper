<script lang="ts">
	import { Markdown } from "@markpage/svelte";
	import { ChevronRight } from "lucide-svelte";

	const { thinking }: { thinking: string } = $props();

	let expanded = $state(false);
</script>

{#if thinking && thinking.length > 0}
	<div class="chat-thinking-container mb-2">
		<button
			class="chat-thinking-toggle flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
			onclick={() => expanded = !expanded}
			aria-expanded={expanded}
		>
			<span>thoughts</span>
			<ChevronRight 
				class="h-4 w-4 transition-transform duration-200 {expanded ? 'rotate-90' : ''}" 
				aria-hidden="true"
			/>
		</button>
		{#if expanded}
			<div class="chat-thinking mt-2 pl-4 border-l-2 border-neutral-200 text-neutral-500 italic">
				<Markdown source={thinking} />
			</div>
		{/if}
	</div>
{/if}

