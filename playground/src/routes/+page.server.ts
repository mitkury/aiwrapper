import { env } from '$env/dynamic/private';
import { chatConfig } from '$lib/server/language';

export function load() {
	return {
		providers: chatConfig(),
		runtime:
			env.AIWRAPPER_RUNTIME === 'rust'
				? env.AIWRAPPER_NATIVE_MOCK === '1'
					? 'Rust mock'
					: 'Rust'
				: 'TypeScript'
	};
}
