<script lang="ts">
	import { readableRequest, type ProviderRequest } from '$lib/realtime/request-snapshot';
	let {
		wire,
		retained,
		requested
	}: { wire?: ProviderRequest; retained: boolean; requested: boolean } = $props();
	let includeImages = $state(false);
	function download() {
		if (!wire) return;
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(wire.body, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${wire.provider}-request.json`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<section aria-label="Provider JSON" class="provider-request">
	{#if wire}
		<div class="heading">
			<strong>{wire.provider} · {wire.model}</strong><button onclick={download}
				>Download full JSON</button
			>
		</div>
		<p class="endpoint">POST {wire.path} · attempt {wire.attempt + 1}</p>
		<p class="note">
			The JSON body captured immediately before the HTTP transport call. Headers and credentials are
			excluded. A captured attempt does not confirm the provider accepted it.
		</p>
		<p class="note">
			Frame timestamps are text blocks immediately before image blocks, for example “Camera frame 7
			at 12.345s (capture clock, session-relative).” These captions are part of the model input.
		</p>
		<label
			><input type="checkbox" bind:checked={includeImages} /> Include image bytes in preview</label
		>
		<p class="note">
			{includeImages
				? 'Complete JSON body, including encoded images.'
				: 'Image byte strings are shortened below; all text, timestamp captions, and JSON structure are preserved. The download always contains the complete body.'}
		</p>
		<pre>{includeImages ? JSON.stringify(wire.body, null, 2) : readableRequest(wire.body)}</pre>
	{:else}<p class="note">
			{!requested
				? 'Waiting for a model request.'
				: !retained
					? 'This request snapshot was evicted from the bounded store.'
					: 'No provider HTTP body captured yet. Offline mode and custom providers may not make an HTTP request.'}
		</p>{/if}
</section>

<style>
	.provider-request {
		padding-top: 18px;
		min-width: 0;
	}
	.heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		font-size: 13px;
		color: #35474e;
	}
	button {
		border: 1px solid #dce3e5;
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 12px;
		cursor: pointer;
	}
	.note {
		font-size: 12px;
		line-height: 1.6;
		color: #73818a;
		margin: 10px 0;
	}
	.endpoint {
		font: 12px monospace;
		overflow-wrap: anywhere;
		margin: 12px 0;
		color: #35474e;
	}
	label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		margin: 16px 0 8px;
	}
	pre {
		max-height: 560px;
		overflow: auto;
		background: #f5f7f8;
		border: 1px solid #e1e7e8;
		border-radius: 8px;
		padding: 16px;
		font-size: 11px;
		line-height: 1.65;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
