<script lang="ts">
	import { getSecrets } from '$lib/secretsContext.svelte';
	import {
		getProviderConfig,
		getProviderModel,
		getProviderModels,
		getSelectedProviderId,
		getModelIdForProvider,
		isProviderConfigured,
		providerConfigs,
		type ProviderId
	} from '$lib/provider-config';
	import Button from './Button.svelte';

	let { disabled = false }: { disabled?: boolean } = $props();

	let showModal = $state(false);
	let localProvider = $state<ProviderId>('openai');
	let localValues = $state<Record<string, string>>({});

	const secrets = getSecrets();
	const localProviderConfig = $derived(getProviderConfig(localProvider));
	const localProviderModels = $derived(getProviderModels(localProviderConfig));
	const selectedModel = $derived(getProviderModel(localProviderConfig, localValues));
	const providerModelId = $derived(getModelIdForProvider(localProviderConfig, selectedModel));
	const selectedModelIsInCatalog = $derived(
		localProviderModels.some((model) => model.id === selectedModel)
	);
	const canSave = $derived(isProviderConfigured(localProviderConfig, localValues));

	$effect(() => {
		localProvider = getSelectedProviderId(secrets.values);
		localValues = { ...secrets.values };
	});

	function openModal() {
		localProvider = getSelectedProviderId(secrets.values);
		localValues = { ...secrets.values };
		showModal = true;
	}

	function closeModal() {
		showModal = false;
	}

	function updateLocalValue(storageKey: string, event: Event) {
		localValues[storageKey] = (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
	}

	function saveSettings() {
		const nextValues = { ...secrets.values, ...localValues };

		for (const provider of providerConfigs) {
			const storageKeys = [
				provider.apiKeyStorageKey,
				provider.modelStorageKey,
				provider.baseURLStorageKey
			].filter((storageKey): storageKey is string => Boolean(storageKey));

			for (const storageKey of storageKeys) {
				if (storageKey in nextValues) {
					nextValues[storageKey] = nextValues[storageKey].trim();
				}
			}

			nextValues[provider.modelStorageKey] = getProviderModel(provider, nextValues);
		}

		secrets.setSecrets({
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

<Button onclick={openModal} {disabled}>Providers & Keys</Button>

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
				Each provider keeps its own key and model, so switching providers does not replace another
				provider's settings.
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
								{provider.label}{isProviderConfigured(provider, localValues) ? ' ✓' : ''}
							</option>
						{/each}
					</select>
				</div>

				{#if localProviderConfig.apiKeyStorageKey}
					<div class="space-y-1.5">
						<label class="block text-sm font-medium text-neutral-700" for="provider-api-key">
							{localProviderConfig.apiKeyLabel}
						</label>
						<input
							id="provider-api-key"
							class="w-full rounded-md border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:ring-neutral-500"
							type="password"
							autocomplete="off"
							value={localValues[localProviderConfig.apiKeyStorageKey] ?? ''}
							oninput={(event) =>
								updateLocalValue(localProviderConfig.apiKeyStorageKey as string, event)}
							placeholder={localProviderConfig.apiKeyPlaceholder}
						/>
					</div>
				{/if}

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
							value={localValues[localProviderConfig.modelStorageKey] ??
								localProviderConfig.defaultModel}
							oninput={(event) => updateLocalValue(localProviderConfig.modelStorageKey, event)}
							placeholder="Provider model ID"
						/>
					{/if}
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

				{#if localProviderConfig.baseURLStorageKey}
					<div class="space-y-1.5">
						<label class="block text-sm font-medium text-neutral-700" for="provider-base-url">
							{localProviderConfig.baseURLLabel}
						</label>
						<input
							id="provider-base-url"
							class="w-full rounded-md border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:ring-neutral-500"
							type="url"
							value={localValues[localProviderConfig.baseURLStorageKey] ??
								localProviderConfig.defaultBaseURL}
							oninput={(event) =>
								updateLocalValue(localProviderConfig.baseURLStorageKey as string, event)}
							placeholder="https://provider.example.com/v1"
						/>
					</div>
				{/if}
			</div>

			<p class="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
				Keys are stored only in this browser's local storage. Use restricted development keys; do
				not use privileged production credentials in a browser app.
			</p>

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
