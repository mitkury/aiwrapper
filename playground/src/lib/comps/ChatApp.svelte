<script lang="ts">
	import { LangMessage, ChatAgent, type LangTool, LangMessages } from 'aiwrapper';
	import ChatInput from './ChatInput.svelte';
	import ChatMessages from './ChatMessages.svelte';
	import ChatMessagesJson from './ChatMessagesJson.svelte';
	import SecretsSetup from './SecretsSetup.svelte';
	import Button from './Button.svelte';
	import ErrorDisplay from './ErrorDisplay.svelte';
	import { onMount } from 'svelte';
	import { getSecrets } from '$lib/secretsContext.svelte';
	import {
		clearStoredMessages,
		ensurePersistentStorage,
		loadStoredMessages,
		saveStoredMessages,
		type StoredMessage
	} from '$lib/storage/messages-store';
	import {
		createLanguageProvider,
		getProviderConfig,
		getSelectedProviderId,
		isProviderConfigured
	} from '$lib/provider-config';

	const tools: LangTool[] = $state([{ name: 'web_search' }, { name: 'image_generation' }]);

	const agent = new ChatAgent();
	agent.messages.availableTools = tools;
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
		const sub = agent.subscribe((event) => {
			if (event.type === 'state') {
				agentIsRunning = event.state === 'running';
			}

			if (event.type === 'error') {
				error = event.error;
			}

			syncMessagesFromAgent();

			if (event.type === 'state' && event.state === 'idle') {
				void persistMessages();
			}
		});

		void initializeStorage();

		return () => sub();
	});

	const secrets = getSecrets();

	$effect(() => {
		const providerId = getSelectedProviderId(secrets.values);
		const provider = getProviderConfig(providerId);
		providerName = provider.label;
		providerReady = isProviderConfigured(provider, secrets.values);
		agent.messages.availableTools = provider.supportsOpenAIBuiltInTools ? tools : [];

		if (!providerReady) {
			return;
		}

		try {
			agent.setLanguageProvider(createLanguageProvider(providerId, secrets.values));
		} catch (providerError) {
			console.error('Could not configure language provider', providerError);
			providerReady = false;
		}
	});

	async function handleSubmit(message: string) {
		error = undefined; // Clear any previous error
		if (!providerReady) {
			error = new Error(`Finish the ${providerName} settings before sending a message.`);
			return;
		}

		agent.messages.addUserMessage(message);
		abortController?.abort();
		const controller = new AbortController();
		abortController = controller;

		try {
			await agent.run(undefined, { signal: controller.signal });
		} catch (err) {
			if (!isAbortError(err)) {
				console.error('Error running agent', err);
				error = err;
			}
		} finally {
			if (abortController === controller) {
				abortController = null;
			}
		}
	}

	async function handleClear() {
		abortController?.abort();
		abortController = null;
		agent.messages.splice(0, agent.messages.length);
		agent.messages.availableTools = getActiveTools();
		messages = [];
		agentIsRunning = false;
		mode = 'chat';
		error = undefined;

		await clearStoredMessages();
	}

	async function handleTryAgain() {
		tryAgain = false;
		error = undefined; // Clear error when retrying
		if (!providerReady) {
			error = new Error(`Finish the ${providerName} settings before retrying.`);
			return;
		}

		abortController?.abort();
		const controller = new AbortController();
		abortController = controller;
		try {
			await agent.run(undefined, { signal: controller.signal });
		} catch (err) {
			if (!isAbortError(err)) {
				console.error('Error running agent', err);
				error = err;
			}
		} finally {
			if (abortController === controller) {
				abortController = null;
			}
		}
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

	function syncMessagesFromAgent() {
		messages = [];

		for (let i = 0; i < agent.messages.length; i++) {
			const current = agent.messages[i];
			messages.push(new LangMessage(current.role, current.items, current.meta));
		}
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
		const storedMessages = agent.messages.map(
			(message): StoredMessage => ({
				role: message.role,
				items: cloneValue(message.items),
				meta: message.meta ? cloneValue(message.meta) : undefined
			})
		);

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

		agent.messages = new LangMessages(storedMessages);
		agent.messages.availableTools = getActiveTools();
		syncMessagesFromAgent();
	}

	function getActiveTools(): LangTool[] {
		const provider = getProviderConfig(getSelectedProviderId(secrets.values));
		return provider.supportsOpenAIBuiltInTools ? tools : [];
	}

	async function initializeStorage() {
		await ensurePersistentStorage();
		await hydrateMessagesFromStorage();

		if (agent.state === 'idle' && waitForResponse) {
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
			<SecretsSetup disabled={agentIsRunning} />
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
