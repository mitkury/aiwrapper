<script lang="ts">
	import { LangMessage, LangMessages } from 'aiwrapper';
	import ChatInput from './ChatInput.svelte';
	import ChatMessages from './ChatMessages.svelte';
	import ChatMessagesJson from './ChatMessagesJson.svelte';
	import ProviderSettings from './ProviderSettings.svelte';
	import Button from './Button.svelte';
	import ErrorDisplay from './ErrorDisplay.svelte';
	import { onMount } from 'svelte';
	import { getProviderPreferences } from '$lib/provider-settings.svelte';
	import {
		clearStoredMessages,
		ensurePersistentStorage,
		loadStoredMessages,
		saveStoredMessages,
		type StoredMessage
	} from '$lib/storage/messages-store';
	import {
		getProviderModel,
		getProviderConfig,
		getSelectedProviderId,
		type ProviderId
	} from '$lib/provider-config';

	import { runChat } from '$lib/chat';

	let {
		providers
	}: {
		providers: Record<ProviderId, { configured: boolean; environmentKey?: string; model: string }>;
	} = $props();

	let agentIsRunning = $state(false);
	let messages: LangMessage[] = $state([]);
	type Mode = 'chat' | 'inspect' | 'json';
	let mode: Mode = $state('chat');
	let error: Error | unknown | undefined = $state(undefined);
	let abortController: AbortController | null = null;
	let providerReady = $state(false);
	let providerName = $state('OpenAI');

	const modeOptions: { id: Mode; label: string }[] = [
		{ id: 'chat', label: 'Chat' },
		{ id: 'inspect', label: 'Inspect' },
		{ id: 'json', label: 'JSON' }
	];

	const waitForResponse = $derived.by(() => {
		if (messages.length === 0) return false;

		// We assume that we need to wait for a response either if the last message
		// belongs to the user or if the agent is running
		return agentIsRunning || messages[messages.length - 1].role === 'user';
	});

	let tryAgain = $state(false);

	onMount(() => {
		void initializeStorage();
		return () => abortController?.abort();
	});

	const settings = getProviderPreferences();

	$effect(() => {
		const providerId = getSelectedProviderId(settings.values);
		const provider = getProviderConfig(providerId);
		providerName = provider.label;
		providerReady = providers[providerId].configured && Boolean(selectedModel());
	});

	function selectedModel() {
		const id = getSelectedProviderId(settings.values);
		const provider = getProviderConfig(id);
		return getProviderModel(provider, settings.values, providers[id].model);
	}

	async function handleSubmit(message: string) {
		if (agentIsRunning || !providerReady) return;
		messages = [...messages, new LangMessage('user', message)];
		await generateResponse();
	}

	async function generateResponse() {
		if (agentIsRunning || !providerReady) return;
		error = undefined;
		tryAgain = false;
		const controller = new AbortController();
		abortController = controller;
		agentIsRunning = true;
		try {
			await runChat(
				getSelectedProviderId(settings.values),
				selectedModel(),
				messages,
				(event) => {
					if (abortController === controller)
						messages = Array.from(new LangMessages(event.messages));
				},
				controller.signal
			);
		} catch (err) {
			if (abortController === controller && !isAbortError(err)) error = err;
		} finally {
			if (abortController === controller) {
				abortController = null;
				agentIsRunning = false;
				tryAgain = messages.at(-1)?.role === 'user' || Boolean(error);
				await persistMessages();
			}
		}
	}

	async function handleClear() {
		abortController?.abort();
		abortController = null;
		messages = [];
		agentIsRunning = false;
		tryAgain = false;
		mode = 'chat';
		error = undefined;
		await clearStoredMessages();
	}

	async function handleTryAgain() {
		await generateResponse();
	}

	function handleDismissError() {
		error = undefined;
	}

	function handleStop() {
		abortController?.abort();
	}

	function isAbortError(value: unknown): boolean {
		return (
			(typeof value === 'object' || typeof value === 'function') &&
			value !== null &&
			Reflect.get(value, 'name') === 'AbortError'
		);
	}

	function setMode(nextMode: Mode) {
		mode = nextMode;
	}

	function cloneValue<T>(value: T): T {
		if (value === undefined || value === null) {
			return value;
		}

		const cloner = (globalThis as typeof globalThis & { structuredClone?: typeof structuredClone })
			.structuredClone;
		if (typeof cloner === 'function') {
			try {
				return cloner(value);
			} catch (error) {
				console.warn('Structured clone failed, falling back to JSON clone', error);
			}
		}

		return JSON.parse(JSON.stringify(value)) as T;
	}

	async function persistMessages() {
		const storedMessages = messages.map((message): StoredMessage => ({
			role: message.role,
			items: cloneValue(message.items),
			meta: message.meta ? cloneValue(message.meta) : undefined
		}));

		const success = await saveStoredMessages(storedMessages);
		if (!success) {
			console.warn('Messages were not saved to IndexedDB');
		}
	}

	async function hydrateMessagesFromStorage() {
		const storedMessages = await loadStoredMessages();
		if (!storedMessages || storedMessages.length === 0) {
			return;
		}

		messages = Array.from(new LangMessages(storedMessages));
	}

	async function initializeStorage() {
		await ensurePersistentStorage();
		await hydrateMessagesFromStorage();

		if (!agentIsRunning && waitForResponse) {
			tryAgain = true;
		}
	}
</script>

<div class="flex min-h-screen flex-col text-neutral-900">
	<div class="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
		<div class="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-white py-2">
			<div
				class="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 p-1"
			>
				{#each modeOptions as option}
					<button
						type="button"
						onclick={() => setMode(option.id)}
						class={`rounded-full px-3 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 ${
							mode === option.id
								? 'bg-neutral-900 text-white'
								: 'text-neutral-600 hover:text-neutral-900'
						}`}
					>
						{option.label}
					</button>
				{/each}
			</div>
			<ProviderSettings {providers} disabled={agentIsRunning} />
			<Button onclick={handleClear} disabled={messages.length === 0 && !agentIsRunning}>
				Clear Chat
			</Button>
		</div>
		<div class="flex-1 overflow-y-auto py-4 sm:py-6">
			{#if mode === 'json'}
				<ChatMessagesJson {messages} />
			{:else}
				<ChatMessages {messages} mode={mode === 'inspect' ? 'inspect' : 'chat'} />
			{/if}
			{#if error}
				<div class="mt-4">
					<ErrorDisplay {error} onDismiss={handleDismissError} />
				</div>
			{/if}
			{#if tryAgain}
				<button
					onclick={handleTryAgain}
					class="rounded bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-800"
				>
					Try Again
				</button>
			{/if}
		</div>

		<div class="sticky bottom-0 border-neutral-200 bg-white py-3">
			<ChatInput
				onsubmit={handleSubmit}
				{waitForResponse}
				isRunning={agentIsRunning}
				{providerReady}
				{providerName}
				onstop={handleStop}
			/>
		</div>
	</div>
</div>
