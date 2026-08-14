<script lang="ts">
	import type { Snippet } from "svelte";

  const { children, onclick, disabled }: { children: Snippet, onclick: () => void, disabled?: boolean } = $props();

  function handleClick() {
    if (disabled) return;

    onclick();
  }
</script>

<button
  type="button"
  disabled={disabled}
  class={`inline-flex items-center px-2 py-1 text-sm transition-colors text-neutral-500 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none`}
  onclick={handleClick}
>
  {@render children()}
</button>

