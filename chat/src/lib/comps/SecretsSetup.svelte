<script lang="ts">
  import { getSecrets } from "$lib/secretsContext.svelte";
  import Button from "./Button.svelte";

  type ProviderId = "openai" | "kimi";
  const providerOptions: { id: ProviderId; label: string }[] = [
    { id: "openai", label: "OpenAI" },
    { id: "kimi", label: "Kimi" }
  ];

  let showModal = $state(false);
  
  const secrets = getSecrets();
  
  let localProvider = $state<ProviderId>((secrets?.values.LLM_PROVIDER as ProviderId) || "openai");
  let localOpenAIKey = $state<string>(secrets?.values.OPENAI_API_SECRET ?? "");
  let localKimiKey = $state<string>(secrets?.values.KIMI_API_SECRET ?? "");

  $effect(() => {
    localProvider = (secrets?.values.LLM_PROVIDER as ProviderId) || "openai";
    localOpenAIKey = secrets?.values.OPENAI_API_SECRET ?? "";
    localKimiKey = secrets?.values.KIMI_API_SECRET ?? "";
  });

  function openModal() {
    showModal = true;
  }

  function closeModal() {
    showModal = false;
  }

  function saveApiKey() {
    secrets.setSecrets({
      ...secrets.values,
      LLM_PROVIDER: localProvider,
      OPENAI_API_SECRET: (localOpenAIKey || "").trim(),
      KIMI_API_SECRET: (localKimiKey || "").trim()
    });
    closeModal();
  }

  const activeKey = $derived(localProvider === "kimi" ? localKimiKey : localOpenAIKey);
  const activeKeyLabel = $derived(localProvider === "kimi" ? "Kimi API Key" : "OpenAI API Key");

  function handleOverlayKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      closeModal();
    }
  }
</script>

<Button onclick={openModal}>
  Provider & Key
</Button>

{#if showModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/30" role="button" tabindex="0" onclick={closeModal} onkeydown={handleOverlayKeydown}></div>
    <div class="relative z-10 w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
      <h2 class="mb-3 text-base font-semibold text-neutral-800">Provider Settings</h2>
      <div class="space-y-2">
        <label class="block text-sm text-neutral-700" for="provider">Provider</label>
        <select
          id="provider"
          class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          bind:value={localProvider}
        >
          {#each providerOptions as option}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </div>
      <div class="mt-3 space-y-2">
        <label class="block text-sm text-neutral-700" for="apiKey">{activeKeyLabel}</label>
        {#if localProvider === "kimi"}
          <input
            id="apiKey"
            class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            type="password"
            bind:value={localKimiKey}
            placeholder="sk-..."
          />
        {:else}
          <input
            id="apiKey"
            class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            type="password"
            bind:value={localOpenAIKey}
            placeholder="sk-..."
          />
        {/if}
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
          disabled={!activeKey.trim()}
        >
          Save
        </button>
      </div>
    </div>
  </div>
{/if}
