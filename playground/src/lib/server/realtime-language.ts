import { env } from '$env/dynamic/private';
import { createLanguageProvider, getProviderConfig, type ProviderId } from '$lib/provider-config';

const environmentKeys: Record<ProviderId, string | undefined> = {
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
	google: 'GOOGLE_API_KEY',
	groq: 'GROQ_API_KEY',
	deepseek: 'DEEPSEEK_API_KEY',
	kimi: 'KIMI_API_KEY',
	xai: 'XAI_API_KEY',
	cohere: 'COHERE_API_KEY',
	mistral: 'MISTRAL_API_KEY',
	openrouter: 'OPENROUTER_API_KEY',
	ollama: undefined,
	'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY'
};

export function realtimeLanguageConfig(): Record<
	ProviderId,
	{ configured: boolean; environmentKey?: string }
> {
	return Object.fromEntries(
		(Object.keys(environmentKeys) as ProviderId[]).map((providerId) => {
			const environmentKey = environmentKeys[providerId];
			const configured =
				providerId === 'ollama'
					? true
					: providerId === 'openai-compatible'
						? Boolean(env.OPENAI_COMPATIBLE_BASE_URL?.trim())
						: Boolean(environmentKey && env[environmentKey]?.trim());
			return [
				providerId,
				{
					configured,
					...(environmentKey ? { environmentKey } : {})
				}
			];
		})
	) as Record<ProviderId, { configured: boolean; environmentKey?: string }>;
}

export function createRealtimeLanguageProvider(providerId: ProviderId, model: string) {
	const provider = getProviderConfig(providerId);
	const environmentKey = environmentKeys[providerId];
	const values: Record<string, string> = {
		[provider.modelStorageKey]: model
	};
	if (provider.apiKeyStorageKey && environmentKey) {
		values[provider.apiKeyStorageKey] = env[environmentKey]?.trim() || '';
	}
	if (provider.baseURLStorageKey) {
		values[provider.baseURLStorageKey] =
			providerId === 'ollama'
				? env.OLLAMA_BASE_URL?.trim() || env.OLLAMA_URL?.trim() || provider.defaultBaseURL || ''
				: env.OPENAI_COMPATIBLE_BASE_URL?.trim() || '';
	}
	return createLanguageProvider(providerId, values, { optimizeForLatency: true });
}
