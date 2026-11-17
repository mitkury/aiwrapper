<script lang="ts">
	import RequestImage from './RequestImage.svelte';
	import {
		readableRequest,
		type RequestSnapshot,
		type RequestItem
	} from '$lib/realtime/request-snapshot';
	let { request }: { request: RequestSnapshot } = $props();
	let rawOpen = $state(false);
	const payload = $derived(request.payload);
	const lastUser = $derived(payload.conversation.messages.findLastIndex((m) => m.role === 'user'));
	function frameFor(messageIndex: number, itemIndex: number) {
		const camera = payload.camera;
		if (!camera || messageIndex !== lastUser || itemIndex < camera.itemStart) return undefined;
		const offset = payload.conversation.messages[messageIndex].items
			.slice(camera.itemStart, itemIndex)
			.filter((i) => i.type === 'image').length;
		return camera.frames[offset];
	}
	function toolImages(item: RequestItem): RequestItem[] {
		// Image-bearing tool results use the native tool-content envelope.
		const result = item.result as { type?: string; content?: RequestItem[] } | undefined;
		return result?.type === 'tool-content' && Array.isArray(result.content)
			? result.content.filter((i) => i.type === 'image')
			: [];
	}
</script>

<section aria-label="Sent to model" class="request-inspector">
	<div class="heading">
		<h3>Sent to model</h3>
		<span>Request {request.itemId} · {request.time}s</span>
	</div>
	<p class="note">
		Frozen input passed to the Rust language provider: instructions, conversation, images, and
		tools. Open Provider JSON to inspect the encoded HTTP body.
	</p>
	<div class="instructions">
		<h4>System instructions</h4>
		<p class="text">{payload.conversation.instructions || '(No system instructions)'}</p>
	</div>
	<div class="heading">
		<h4>
			Conversation · {payload.conversation.messages.length}
			{payload.conversation.messages.length === 1 ? 'message' : 'messages'}
		</h4>
		<span>In request order</span>
	</div>
	{#each payload.conversation.messages as message, mi}
		<article class:current={mi === lastUser}>
			<h4>{mi + 1} · {message.role}{mi === lastUser ? ' · current input' : ''}</h4>
			{#each message.items as item, ii}
				{#if item.type === 'text'}<p class="text">{item.text}</p>
				{:else if item.type === 'image' && item.base64}
					{@const frame = frameFor(mi, ii)}
					<div class="image">
						<RequestImage
							data={item.base64}
							mime={item.mimeType || 'image/jpeg'}
							label={frame ? `Frame #${frame.id}` : `Image ${ii + 1}`}
							caption={frame
								? `Captured ${(frame.capturedAtMs / 1000).toFixed(2)}s · ${frame.clock} clock · message ${mi + 1}`
								: `Image attachment · message ${mi + 1}`}
						/>
					</div>
				{:else}<details class="item">
						<summary>{item.type}{item.name ? ` · ${item.name}` : ''}</summary>
						<pre>{readableRequest(item)}</pre>
					</details>
					{#each toolImages(item) as image, i}{#if image.base64}<div class="image">
								<RequestImage
									data={image.base64}
									mime={image.mimeType || 'image/jpeg'}
									label={`Tool image ${i + 1}`}
									caption={`Tool result · message ${mi + 1}`}
								/>
							</div>{/if}{/each}
				{/if}
			{/each}
		</article>
	{/each}
	<details class="item">
		<summary>Tools available · {payload.tools?.length ?? 0}</summary>
		<pre>{readableRequest(payload.tools ?? [])}</pre>
	</details>
	<p class="note">Maximum output tokens: {payload.maxTokens ?? 'Not specified'}</p>
	<details class="item" bind:open={rawOpen}>
		<summary>Request structure · image bytes omitted</summary>{#if rawOpen}<pre>{readableRequest(
					payload
				)}</pre>{/if}
	</details>
</section>

<style>
	.request-inspector {
		min-width: 0;
		color: #35474e;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
		align-items: baseline;
		margin: 18px 0 10px;
	}
	h3,
	h4 {
		font-size: 13px;
		font-weight: 600;
	}
	.heading span,
	.note {
		font-size: 12px;
		color: #73818a;
		line-height: 1.6;
	}
	.instructions,
	article {
		padding: 16px;
		border: 1px solid #e1e7e8;
		border-radius: 8px;
		margin: 12px 0;
	}
	.instructions {
		background: #f5f7f8;
	}
	article.current {
		border-left: 3px solid #438571;
	}
	article h4 {
		color: #647780;
		margin-bottom: 10px;
	}
	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 13px;
		line-height: 1.65;
		margin-top: 8px;
	}
	.image {
		display: inline-block;
		vertical-align: top;
		width: min(220px, 100%);
		margin: 12px 12px 4px 0;
	}
	.item {
		border-top: 1px solid #e9edef;
		margin-top: 12px;
	}
	summary {
		padding: 12px 0;
		cursor: pointer;
		font-size: 12px;
	}
	pre {
		font-size: 11px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 400px;
		overflow: auto;
		padding: 12px;
		background: #f5f7f8;
		border-radius: 6px;
	}
</style>
