<script lang="ts">
	import { page } from '$app/state';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	const sections = [
		{ href: '/', label: 'Chat' },
		{ href: '/speech', label: 'Voice' },
		{ href: '/realtime', label: 'Realtime' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>AIWrapper playground</title>
</svelte:head>

<header class="border-b border-neutral-200 bg-white">
	<div class="mx-auto flex w-full max-w-3xl items-center gap-5 px-4 py-3">
		<a href="/" class="mr-auto text-sm font-semibold tracking-tight text-neutral-900">
			AIWrapper playground
		</a>
		<nav aria-label="Playground sections" class="flex items-center gap-1">
			{#each sections as section}
				<a
					href={section.href}
					aria-current={page.url.pathname === section.href ? 'page' : undefined}
					class={`rounded-full px-3 py-1.5 text-sm font-medium ${
						page.url.pathname === section.href
							? 'bg-neutral-900 text-white'
							: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
					}`}
				>
					{section.label}
				</a>
			{/each}
		</nav>
	</div>
</header>

{@render children()}
