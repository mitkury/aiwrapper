<script lang="ts">
	interface Props {
		error: Error | unknown;
		onDismiss: () => void;
	}

	let { error, onDismiss }: Props = $props();

	const message = $derived.by(() => {
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
	});
</script>

<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
	<div class="flex items-start justify-between gap-4">
		<div class="flex-1">
			<h3 class="mb-2 font-semibold text-red-900">Error</h3>
			<p class="text-sm text-red-800">{message}</p>
		</div>
		<button onclick={onDismiss} class="text-red-600 hover:text-red-800" aria-label="Dismiss error">
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M6 18L18 6M6 6l12 12"
				/>
			</svg>
		</button>
	</div>
</div>
