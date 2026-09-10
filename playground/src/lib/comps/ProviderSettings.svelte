<script lang="ts">
	import { getProviderPreferences } from '$lib/provider-settings.svelte';
	import {
		getProviderConfig,
		getProviderModel,
		getProviderModels,
		getSelectedProviderId,
		getModelIdForProvider,
		providerConfigs,
		type ProviderId
	} from '$lib/provider-config';
	import Button from './Button.svelte';

	let {
		disabled = false,
		providers
	}: {
		disabled?: boolean;
		providers: Record<ProviderId, { configured: boolean; environmentKey?: string; model: string }>;
	} = $props();

	let showModal = $state(false);
	let localProvider = $state<ProviderId>('openai');
	let localValues = $state<Record<string, string>>({});

	const settings = getProviderPreferences();
	const localProviderConfig = $derived(getProviderConfig(localProvider));
	const localProviderModels = $derived(getProviderModels(localProviderConfig));
	const selectedModel = $derived(
		getProviderModel(localProviderConfig, localValues, providers[localProvider].model)
	);
	const providerModelId = $derived(getModelIdForProvider(localProviderConfig, selectedModel));
	const selectedModelIsInCatalog = $derived(
		localProviderModels.some((model) => model.id === selectedModel)
	);
	const canSave = $derived(providers[localProvider].configured && Boolean(selectedModel));

	$effect(() => {
		localProvider = getSelectedProviderId(settings.values);
		localValues = { ...settings.values };
	});

	function openModal() {
		localProvider = getSelectedProviderId(settings.values);
		localValues = { ...settings.values };
		showModal = true;
	}

	function closeModal() {
		showModal = false;
	}

	function updateLocalValue(storageKey: string, event: Event) {
		localValues[storageKey] = (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
	}

	function saveSettings() {
		const nextValues = { ...settings.values, ...localValues };

		settings.setProviderPreferences({
			...nextValues,
			LLM_PROVIDER: localProvider
		});
		closeModal();
	}

	function handleOverlayKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			closeModal();
		}
	}
</script>

<Button onclick={openModal} {disabled}>Providers & Models</Button>

{#if showModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center px-4">
		<div
			class="absolute inset-0 bg-black/30"
			role="button"
			tabindex="0"
			aria-label="Close provider settings"
			onclick={closeModal}
			onkeydown={handleOverlayKeydown}
		></div>
		<div
			class="relative z-10 w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="provider-settings-title"
		>
			<h2 id="provider-settings-title" class="text-base font-semibold text-neutral-900">
				Provider settings
			</h2>
			<p class="mt-1 text-sm text-neutral-500">
				All examples use credentials from the repository root .env file. Model selections are saved
				in this browser.
			</p>

			<div class="mt-5 space-y-4">
				<div class="space-y-1.5">
					<label class="block text-sm font-medium text-neutral-700" for="settings-provider">
						Provider
					</label>
					<select
						id="settings-provider"
						class="w-full rounded-md border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:ring-neutral-500"
						bind:value={localProvider}
					>
						{#each providerConfigs as provider}
							<option value={provider.id}>
								{provider.label}{providers[provider.id].configured ? ' ✓' : ''}
							</option>
						{/each}
					</select>
				</div>

				<p class="text-xs text-neutral-500">
					{#if providers[localProvider].configured}
						Configured on the server.
					{:else}
						Add <code
							>{localProviderConfig.apiKeyRequired
								? localProviderConfig.apiKeyEnvironmentKey
								: localProviderConfig.baseURLEnvironmentKey}</code
						> to .env.
					{/if}
				</p>

				<div class="space-y-1.5">
					<label class="block text-sm font-medium text-neutral-700" for="provider-model">
						Model
					</label>
					{#if localProviderModels.length > 0}
						<select
							id="provider-model"
							class="w-full rounded-md border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:ring-neutral-500"
							value={selectedModel}
							onchange={(event) => updateLocalValue(localProviderConfig.modelStorageKey, event)}
						>
							{#if !selectedModelIsInCatalog && selectedModel}
								<option value={selectedModel}>{selectedModel} (custom)</option>
							{/if}
							{#each localProviderModels as model}
								<option value={model.id}>
									{model.name} — {getModelIdForProvider(localProviderConfig, model.id)}
								</option>
							{/each}
						</select>
					{:else}
						<input
							id="provider-model"
							class="w-full rounded-md border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:ring-neutral-500"
							type="text"
							value={selectedModel}
							oninput={(event) => updateLocalValue(localProviderConfig.modelStorageKey, event)}
							placeholder="Provider model ID"
						/>
					{/if}
					<div class="flex items-center justify-between gap-2 text-xs text-neutral-500">
						<span>Default: {providers[localProvider].model || 'Set a model in .env'}</span>
						<button
							type="button"
							class="shrink-0 underline"
							onclick={() => (localValues[localProviderConfig.modelStorageKey] = '')}
						>
							Use default
						</button>
					</div>
					<p class="text-xs text-neutral-500">
						{#if localProviderModels.length > 0}
							{localProviderModels.length} chat models from the local AI Models catalog.
						{:else}
							Enter a model ID supported by this endpoint.
						{/if}
						{#if selectedModel && providerModelId !== selectedModel}
							Provider API ID: <code>{providerModelId}</code>
						{/if}
					</p>
				</div>
			</div>

			<div class="mt-5 flex justify-end gap-2">
				<button
					class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
					type="button"
					onclick={closeModal}
				>
					Cancel
				</button>
				<button
					class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
					type="button"
					onclick={saveSettings}
					disabled={!canSave}
				>
					Save & use provider
				</button>
			</div>
		</div>
	</div>
{/if}
