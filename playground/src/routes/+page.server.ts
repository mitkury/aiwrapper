import { languageConfig } from '$lib/server/language';

export function load() {
	return { providers: languageConfig() };
}
