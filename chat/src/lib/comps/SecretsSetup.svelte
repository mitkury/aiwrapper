<script lang="ts">
  import { getSecrets } from "$lib/secretsContext.svelte";

  let showModal = $state(false);
  
  const secrets = getSecrets();
  
  let localApiKey = $state<string>(secrets?.values.OPENAI_API_SECRET ?? "");

  $effect(() => {
    localApiKey = secrets?.values.OPENAI_API_SECRET ?? "";
  });

  function openModal() {
    showModal = true;
  }

  function closeModal() {
    showModal = false;
  }

  function saveApiKey() {
    const value = (localApiKey || "").trim();
    // Update secrets context
    secrets.setSecret("OPENAI_API_SECRET", value || "");
    closeModal();
  }

  function handleOverlayKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      closeModal();
    }
  }
</script>

<div class="flex items-center justify-end pb-2">
  <button
    class="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
    onclick={openModal}
    aria-label="Set OpenAI API Key"
  >
    Set API Key
  </button>
  {#if localApiKey}
    <span class="ml-2 text-xs text-green-600">API key set</span>
  {/if}
  {#if !localApiKey || localApiKey.trim() === ""}
    <span class="ml-2 text-xs text-red-600">No API key</span>
  {/if}
</div>

{#if showModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/30" role="button" tabindex="0" onclick={closeModal} onkeydown={handleOverlayKeydown}></div>
    <div class="relative z-10 w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
      <h2 class="mb-3 text-base font-semibold text-neutral-800">OpenAI API Key</h2>
      <div class="space-y-2">
        <label class="block text-sm text-neutral-700" for="apiKey">Enter your API key</label>
        <input
          id="apiKey"
          class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          type="password"
          bind:value={localApiKey}
          placeholder="sk-..."
        />
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <button
          class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          type="button"
          onclick={closeModal}
        >
          Cancel
        </button>
        <button
          class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          type="button"
          onclick={saveApiKey}
          disabled={!localApiKey.trim()}
        >
          Save
        </button>
      </div>
    </div>
  </div>
{/if}


