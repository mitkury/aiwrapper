import { env } from '$env/dynamic/private';
import {
	createLanguageProvider,
	getProviderConfig,
	getProviderModel,
	providerConfigs,
	type ProviderId
} from '$lib/provider-config';

function providerValues(providerId: ProviderId): Record<string, string> {
	const provider = getProviderConfig(providerId);
	const values: Record<string, string> = {};
	for (const key of [
		provider.apiKeyEnvironmentKey,
		provider.modelStorageKey,
		provider.baseURLEnvironmentKey
	]) {
		if (key) values[key] = env[key]?.trim() || '';
	}
	if (providerId === 'ollama') {
		values.OLLAMA_BASE_URL ||= env.OLLAMA_URL?.trim() || provider.defaultBaseURL || '';
	}
	return values;
}

export function languageConfig() {
	return Object.fromEntries(
		providerConfigs.map((provider) => {
			const values = providerValues(provider.id);
			const environmentKey = provider.apiKeyEnvironmentKey;
			const configured = provider.apiKeyRequired
				? Boolean(environmentKey && values[environmentKey])
				: provider.id !== 'openai-compatible' || Boolean(values.OPENAI_COMPATIBLE_BASE_URL);
			return [
				provider.id,
				{
					configured,
					environmentKey,
					model: getProviderModel(provider, values)
				}
			];
		})
	) as Record<ProviderId, { configured: boolean; environmentKey?: string; model: string }>;
}

export function createServerLanguageProvider(
	providerId: ProviderId,
	model: string,
	options: { optimizeForLatency?: boolean } = {}
) {
	const provider = getProviderConfig(providerId);
	const values = providerValues(providerId);
	if (model.trim()) values[provider.modelStorageKey] = model.trim();
	if (!languageConfig()[providerId].configured) {
		throw new Error(
			`${provider.apiKeyRequired ? provider.apiKeyEnvironmentKey : provider.baseURLEnvironmentKey} is not configured`
		);
	}
	return createLanguageProvider(providerId, values, options);
}
