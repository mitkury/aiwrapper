<script lang="ts">
	let {
		data,
		mime,
		label,
		caption = '',
		inspectLabel = `Inspect ${label}`,
		fullLabel = `Full-size ${label}`,
		dialogLabel = 'Image preview'
	}: {
		data: string;
		mime: string;
		label: string;
		caption?: string;
		inspectLabel?: string;
		fullLabel?: string;
		dialogLabel?: string;
	} = $props();
	let dialog: HTMLDialogElement;
	let open = $state(false);
</script>

<figure>
	<button
		class="frame-thumbnail"
		aria-label={inspectLabel}
		onclick={() => {
			open = true;
			dialog.showModal();
		}}
	>
		<img
			loading="lazy"
			decoding="async"
			src={`data:${mime};base64,${data}`}
			alt={label}
			class="thumbnail-image"
		/>
	</button>
	<figcaption>{caption}</figcaption>
</figure>
<dialog
	aria-label={dialogLabel}
	bind:this={dialog}
	onclose={() => (open = false)}
	class="frame-dialog"
>
	{#if open}<div class="preview-heading">
			<div>
				<strong>{label}</strong>
				<p>{caption}</p>
			</div>
			<button onclick={() => dialog.close()}>Close preview</button>
		</div>
		<img src={`data:${mime};base64,${data}`} alt={fullLabel} />{/if}
</dialog>

<style>
	.thumbnail-image {
		width: 100%;
		aspect-ratio: 16/9;
		object-fit: contain;
		border: 1px solid #dce3e5;
		border-radius: 6px;
		background: #f3f5f6;
	}
	figcaption {
		margin-top: 4px;
		font-size: 12px;
		color: #5e7078;
	}
	.frame-thumbnail {
		display: block;
		width: 100%;
		padding: 0;
		cursor: zoom-in;
		border-radius: 6px;
		overflow: hidden;
	}
	.frame-thumbnail:focus-visible {
		outline: 2px solid #176957;
		outline-offset: 3px;
	}
	.frame-thumbnail:hover {
		box-shadow: 0 0 0 2px #176957;
	}
	.frame-dialog {
		margin: auto;
		max-width: min(960px, 94vw);
		max-height: 90vh;
		overflow: auto;
		padding: 0;
		border: 1px solid #dfe5e7;
		border-radius: 12px;
		background: white;
		box-shadow: 0 24px 80px #152d3540;
	}
	.frame-dialog::backdrop {
		background: #14232b99;
	}
	.preview-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		padding: 16px 20px;
		font-size: 14px;
		color: #35474e;
	}
	.preview-heading p {
		font-size: 12px;
		color: #78858c;
		margin-top: 3px;
	}
	.preview-heading button {
		border: 1px solid #dce3e5;
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 12px;
		cursor: pointer;
	}
	.frame-dialog img {
		display: block;
		width: 900px;
		max-width: 100%;
		height: auto;
	}
</style>
