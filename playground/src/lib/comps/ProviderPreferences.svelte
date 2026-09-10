<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { getProviderPreferences } from '$lib/provider-settings.svelte';

	const settings = getProviderPreferences();

	const { children }: { children: Snippet } = $props();

	onMount(() => {
		settings.loadProviderPreferences();
	});
</script>

{@render children()}
