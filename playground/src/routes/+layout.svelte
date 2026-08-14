<script lang="ts">
	import { page } from '$app/state';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	const sections = [
		{ href: '/', label: 'Playground' },
		{ href: '/speech', label: 'Voice' },
		{ href: '/realtime', label: 'Realtime' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>AIWrapper playground</title>
</svelte:head>

<header class="border-b border-neutral-200 bg-white">
	<div class="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
		<a href="/" class="shrink-0 text-sm font-semibold tracking-tight text-neutral-900">
			AIWrapper playground
		</a>
		<nav aria-label="Playground sections" class="flex shrink-0 items-center gap-0.5 sm:gap-1">
			{#each sections as section}
				<a
					href={section.href}
					aria-current={page.url.pathname === section.href ? 'page' : undefined}
					class={`rounded-full px-2 py-1.5 text-xs font-medium sm:px-3 sm:text-sm ${
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
