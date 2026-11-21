<script lang="ts">
	import { page } from '$app/state';
	import NativeVoice from '$lib/comps/NativeVoice.svelte';
</script>

{#key page.url.searchParams.get('input')}
	<NativeVoice live simulator={page.url.searchParams.get('input') === 'room'} />
{/key}
