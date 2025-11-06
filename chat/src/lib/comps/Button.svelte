<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  export let type: HTMLButtonAttributes["type"] = "button";
  export let disabled = false;
  export let active = false;
  export let toggle = false;

  const dispatch = createEventDispatcher<{ toggle: { active: boolean } }>();

  function handleClick() {
    if (disabled) return;
    if (toggle) {
      active = !active;
      dispatch("toggle", { active });
    }
  }
</script>

<button
  type={type}
  disabled={disabled}
  aria-pressed={toggle ? active : undefined}
  class={`inline-flex items-center px-2 py-1 text-sm transition-colors ${
    active ? "text-neutral-900" : "text-neutral-500"
  } hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none`}
  on:click={handleClick}
  {...$$restProps}
>
  <slot />
</button>

