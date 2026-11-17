<script lang="ts">
	import RequestImage from './RequestImage.svelte';
	let {
		requests,
		selected = $bindable(0),
		dropped = 0,
		compact = false
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
		compact?: boolean;
	} = $props();
	const request = $derived(requests[selected]);
</script>

<section class="space-y-4 p-5" aria-label="Frames sent to the model">
	{#if !compact}<p class="text-xs text-neutral-500">
			Exact camera images in the Rust request. Shared with the request inspector: last 8 requests,
			up to 16 MiB including text and images. {dropped ? `${dropped} older requests removed.` : ''}
		</p>
	{/if}
	{#if requests.length}
		{#if !compact}<label class="flex items-center gap-3 text-sm"
				>Request<select aria-label="Frame request" bind:value={selected} class="rounded border p-2">
					{#each requests as request, i}<option value={i}
							>{request.time}s · {request.frames.length} frames · {request.camera.policy}</option
						>{/each}
				</select></label
			>
		{/if}
		{#if request}
			{#if compact}<p class="text-xs text-neutral-500">
					{request.frames.length} of {request.camera.candidateCount} frames selected{request.camera
						.omittedCount
						? ` · ${request.camera.omittedCount} omitted`
						: ''}{request.camera.evictedSincePreviousTurn
						? ` · ${request.camera.evictedSincePreviousTurn} evicted from input buffer`
						: ''}{request.camera.reusedLatest ? ' · latest frame reused' : ''}.
				</p>
			{:else}<p class="text-sm text-neutral-600">
					{request.frames.length} selected from {request.camera.candidateCount} candidates. {request
						.camera.omittedCount} omitted by selection or size limits. {request.camera
						.evictedSincePreviousTurn} frames evicted from the input buffer since the previous turn.{request
						.camera.reusedLatest
						? ' Reused the latest frame because no new frames arrived.'
						: ''}
				</p>
			{/if}
			<div class:filmstrip={compact} class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
				{#each request.frames as frame}<div class="frame">
						<RequestImage
							data={frame.data}
							mime={frame.mime}
							label={`Frame #${frame.id}`}
							caption={`#${frame.id} · ${(frame.capturedAtMs / 1000).toFixed(2)}s · ${frame.clock}`}
							inspectLabel={`Inspect frame ${frame.id}`}
							fullLabel={`Full-size frame ${frame.id}`}
							dialogLabel="Frame preview"
						/>
					</div>{/each}
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

<style>
	.filmstrip {
		display: flex;
		overflow-x: auto;
		padding: 3px 2px 10px;
	}
	.filmstrip .frame {
		flex: 0 0 150px;
	}
</style>
