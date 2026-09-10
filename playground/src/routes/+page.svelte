<script lang="ts">
	import ChatApp from '$lib/comps/ChatApp.svelte';
	import ProviderPreferences from '$lib/comps/ProviderPreferences.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<ProviderPreferences>
	<ChatApp providers={data.providers} />
</ProviderPreferences>
