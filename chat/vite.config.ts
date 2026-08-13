import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		// Keep a locally linked aimodels package out of Vite's persistent
		// prebundle so catalog and provider-ID changes are visible immediately.
		exclude: ['aimodels']
	},
	resolve: {
		alias: {
			// Resolve "aiwrapper" to the local source directory one level up
			aiwrapper: fileURLToPath(new URL('../src', import.meta.url))
		}
	}
});
