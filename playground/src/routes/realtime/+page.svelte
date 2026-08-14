<script lang="ts">
	import RealtimePlayground from '$lib/comps/RealtimePlayground.svelte';
	import Secrets from '$lib/comps/Secrets.svelte';
</script>

<svelte:head>
	<title>Realtime agent · AIWrapper</title>
</svelte:head>

<Secrets>
	<RealtimePlayground />
</Secrets>
