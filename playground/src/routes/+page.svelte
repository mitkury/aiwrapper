<script lang="ts">
	import ChatApp from '$lib/comps/ChatApp.svelte';
	import ProviderPreferences from '$lib/comps/ProviderPreferences.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<p class="px-4 pt-3 text-xs text-gray-500">Chat runtime: {data.runtime}</p>

<ProviderPreferences>
	<ChatApp providers={data.providers} />
</ProviderPreferences>
