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
</script>

<section
	class="space-y-3 rounded-xl border border-neutral-200 p-4"
	aria-label="Frames sent to the model"
>
	<h2 class="font-medium">Frames sent to the model</h2>
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
						<img
							src={`data:${frame.mime};base64,${frame.data}`}
							alt={`Frame ${frame.id} at ${(frame.capturedAtMs / 1000).toFixed(2)} seconds`}
							class="aspect-video w-full rounded border bg-neutral-100 object-contain"
						/>
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
