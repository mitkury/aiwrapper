import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			// Resolve "aiwrapper" to the local source directory one level up
			aiwrapper: fileURLToPath(new URL('../src', import.meta.url))
		}
	}
});
