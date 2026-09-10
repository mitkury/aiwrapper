<script lang="ts">
	import RealtimePlayground from '$lib/comps/RealtimePlayground.svelte';
	import ProviderPreferences from '$lib/comps/ProviderPreferences.svelte';
</script>

<svelte:head>
	<title>Realtime agent · AIWrapper</title>
</svelte:head>

<ProviderPreferences>
	<RealtimePlayground />
</ProviderPreferences>
