import { getContext, hasContext, setContext } from 'svelte';
import { providerConfigs } from './provider-config';

const storageKey = 'provider-settings';
const allowedKeys = new Set([
	'LLM_PROVIDER',
	'REALTIME_STT_PROVIDER',
	'REALTIME_TTS_PROVIDER',
	...providerConfigs.map((provider) => provider.modelStorageKey),
	...['OPENAI', 'DEEPGRAM', 'ELEVENLABS'].map((provider) => `REALTIME_${provider}_STT_MODEL`),
	...['OPENAI', 'ELEVENLABS'].flatMap((provider) => [
		`REALTIME_${provider}_TTS_MODEL`,
		`REALTIME_${provider}_TTS_VOICE`
	])
]);

export function filterProviderPreferences(values: unknown): Record<string, string> {
	if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
	return Object.fromEntries(
		Object.entries(values).filter(
			([key, value]) => allowedKeys.has(key) && typeof value === 'string'
		)
	) as Record<string, string>;
}

class ProviderSettingsStore {
	values: Record<string, string> = $state({});

	setProviderPreferences(values: Record<string, string>) {
		Object.assign(this.values, filterProviderPreferences(values));
		try {
			localStorage.setItem(storageKey, JSON.stringify($state.snapshot(this.values)));
		} catch (error) {
			console.warn('Provider settings could not be saved to local storage', error);
		}
	}

	loadProviderPreferences() {
		try {
			const saved = localStorage.getItem(storageKey) ?? localStorage.getItem('secrets');
			if (saved) this.setProviderPreferences(filterProviderPreferences(JSON.parse(saved)));
			localStorage.removeItem('secrets');
		} catch (error) {
			console.warn('Provider settings could not be loaded from local storage', error);
		}
	}
}

export function getProviderPreferences(): ProviderSettingsStore {
	if (hasContext(storageKey)) return getContext<ProviderSettingsStore>(storageKey);
	const settings = new ProviderSettingsStore();
	setContext(storageKey, settings);
	return settings;
}
