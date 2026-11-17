<script lang="ts">
	let {
		requests,
		selected = $bindable(0),
		dropped = 0
	}: {
		requests: {
			time: string;
			camera: {
				candidateCount: number;
				omittedCount: number;
				evictedSincePreviousTurn: number;
				reusedLatest: boolean;
				policy: string;
			};
			frames: { id: number; capturedAtMs: number; clock: string; data: string; mime: string }[];
		}[];
		selected?: number;
		dropped?: number;
	} = $props();
	const request = $derived(requests[selected]);
	let preview = $state<(typeof requests)[number]['frames'][number] | null>(null);
	let previewDialog: HTMLDialogElement;
</script>

<section class="space-y-4 p-5" aria-label="Frames sent to the model">
	<p class="text-xs text-neutral-500">
		Exact camera images in the Rust request. Retained after disconnect: last 8 requests, up to 16
		MiB. {dropped ? `${dropped} older requests removed.` : ''}
	</p>
	{#if requests.length}
		<label class="flex items-center gap-3 text-sm"
			>Request<select aria-label="Frame request" bind:value={selected} class="rounded border p-2">
				{#each requests as request, i}<option value={i}
						>{request.time}s · {request.frames.length} frames · {request.camera.policy}</option
					>{/each}
			</select></label
		>
		{#if request}
			<p class="text-sm text-neutral-600">
				{request.frames.length} selected from {request.camera.candidateCount} candidates. {request
					.camera.omittedCount} omitted by selection or size limits. {request.camera
					.evictedSincePreviousTurn} frames evicted from the input buffer since the previous turn.{request
					.camera.reusedLatest
					? ' Reused the latest frame because no new frames arrived.'
					: ''}
			</p>
			<div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
				{#each request.frames as frame}<figure>
						<button
							class="frame-thumbnail"
							aria-label={`Inspect frame ${frame.id}`}
							onclick={() => {
								preview = frame;
								previewDialog.showModal();
							}}
						>
							<img
								src={`data:${frame.mime};base64,${frame.data}`}
								alt={`Frame ${frame.id} at ${(frame.capturedAtMs / 1000).toFixed(2)} seconds`}
								class="aspect-video w-full rounded border bg-neutral-100 object-contain"
							/>
						</button>
						<figcaption class="mt-1 text-xs text-neutral-600">
							#{frame.id} · {(frame.capturedAtMs / 1000).toFixed(2)}s · {frame.clock}
						</figcaption>
					</figure>{/each}
			</div>
			{#if !request.frames.length}<p class="text-sm text-neutral-500">
					No eligible camera frames in this request.
				</p>{/if}
		{/if}
	{:else}<p class="text-sm text-neutral-500">
			Connect and ask a question to inspect its selected frames. Offline mode tests selection
			without visual understanding.
		</p>{/if}
</section>

<dialog
	aria-label="Frame preview"
	bind:this={previewDialog}
	onclose={() => (preview = null)}
	class="frame-dialog"
>
	{#if preview}<div class="preview-heading">
			<div>
				<strong>Frame #{preview.id}</strong>
				<p>{(preview.capturedAtMs / 1000).toFixed(2)}s · {preview.clock} time</p>
			</div>
			<button onclick={() => previewDialog.close()}>Close preview</button>
		</div>
		<img
			src={`data:${preview.mime};base64,${preview.data}`}
			alt={`Full-size frame ${preview.id}`}
		/>{/if}
</dialog>

<style>
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
