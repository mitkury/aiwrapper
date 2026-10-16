import { env } from '$env/dynamic/private';
import { languageConfig } from '$lib/server/language';

export function load() {
	return {
		providers: languageConfig(),
		runtime: env.AIWRAPPER_RUNTIME === 'rust' ? 'Rust' : 'TypeScript'
	};
}
