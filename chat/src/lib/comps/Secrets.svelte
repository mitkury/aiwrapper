<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import SecretsSetup from "./SecretsSetup.svelte";
  import { getSecrets } from "$lib/secretsContext.svelte";

  const secrets = getSecrets();

  const { children }: { children: Snippet } = $props();

  onMount(() => {
    secrets.loadSecrets();
  });
</script>

<SecretsSetup />

{@render children()}