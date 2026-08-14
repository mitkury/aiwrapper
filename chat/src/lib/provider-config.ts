import { Lang, models, type LanguageProvider, type Model } from 'aiwrapper';

type ProviderAwareModel = Model & {
	idFor?: (providerId: string) => string | undefined;
};

type ProviderAwareModels = typeof models & {
	fromProviderId?: (providerId: string, providerModelId: string) => Model | undefined;
	resolveModelIdForProvider?: (modelId: string, providerId: string) => string | undefined;
};

const providerAwareModels = models as ProviderAwareModels;

export type ProviderId =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'groq'
	| 'deepseek'
	| 'kimi'
	| 'xai'
	| 'cohere'
	| 'mistral'
	| 'openrouter'
	| 'ollama'
	| 'openai-compatible';

export type ProviderConfig = {
	id: ProviderId;
	label: string;
	apiKeyStorageKey?: string;
	apiKeyLabel?: string;
	apiKeyPlaceholder?: string;
	apiKeyRequired: boolean;
	modelStorageKey: string;
	defaultModel: string;
	catalogProviderId?: string;
	baseURLStorageKey?: string;
	defaultBaseURL?: string;
	baseURLLabel?: string;
	supportsOpenAIBuiltInTools?: boolean;
};

export const providerConfigs: ProviderConfig[] = [
	{
		id: 'openai',
		label: 'OpenAI',
		apiKeyStorageKey: 'OPENAI_API_SECRET',
		apiKeyLabel: 'OpenAI API key',
		apiKeyPlaceholder: 'sk-...',
		apiKeyRequired: true,
		modelStorageKey: 'OPENAI_MODEL',
		defaultModel: 'gpt-5.4',
		catalogProviderId: 'openai',
		supportsOpenAIBuiltInTools: true
	},
	{
		id: 'anthropic',
		label: 'Anthropic',
		apiKeyStorageKey: 'ANTHROPIC_API_SECRET',
		apiKeyLabel: 'Anthropic API key',
		apiKeyPlaceholder: 'sk-ant-...',
		apiKeyRequired: true,
		modelStorageKey: 'ANTHROPIC_MODEL',
		defaultModel: 'claude-sonnet-4-6',
		catalogProviderId: 'anthropic'
	},
	{
		id: 'google',
		label: 'Google Gemini',
		apiKeyStorageKey: 'GOOGLE_API_SECRET',
		apiKeyLabel: 'Google AI API key',
		apiKeyPlaceholder: 'AIza...',
		apiKeyRequired: true,
		modelStorageKey: 'GOOGLE_MODEL',
		defaultModel: 'gemini-2.5-pro',
		catalogProviderId: 'google'
	},
	{
		id: 'groq',
		label: 'Groq',
		apiKeyStorageKey: 'GROQ_API_SECRET',
		apiKeyLabel: 'Groq API key',
		apiKeyPlaceholder: 'gsk_...',
		apiKeyRequired: true,
		modelStorageKey: 'GROQ_MODEL',
		defaultModel: 'llama3-70b-8192',
		catalogProviderId: 'groq'
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		apiKeyStorageKey: 'DEEPSEEK_API_SECRET',
		apiKeyLabel: 'DeepSeek API key',
		apiKeyPlaceholder: 'sk-...',
		apiKeyRequired: true,
		modelStorageKey: 'DEEPSEEK_MODEL',
		defaultModel: 'deepseek-chat',
		catalogProviderId: 'deepseek'
	},
	{
		id: 'kimi',
		label: 'Kimi',
		apiKeyStorageKey: 'KIMI_API_SECRET',
		apiKeyLabel: 'Kimi API key',
		apiKeyPlaceholder: 'sk-...',
		apiKeyRequired: true,
		modelStorageKey: 'KIMI_MODEL',
		defaultModel: 'kimi-k2.5',
		catalogProviderId: 'kimi'
	},
	{
		id: 'xai',
		label: 'xAI',
		apiKeyStorageKey: 'XAI_API_SECRET',
		apiKeyLabel: 'xAI API key',
		apiKeyPlaceholder: 'xai-...',
		apiKeyRequired: true,
		modelStorageKey: 'XAI_MODEL',
		defaultModel: 'grok-2',
		catalogProviderId: 'xai'
	},
	{
		id: 'cohere',
		label: 'Cohere',
		apiKeyStorageKey: 'COHERE_API_SECRET',
		apiKeyLabel: 'Cohere API key',
		apiKeyPlaceholder: '...',
		apiKeyRequired: true,
		modelStorageKey: 'COHERE_MODEL',
		defaultModel: 'command-r-plus-08-2024',
		catalogProviderId: 'cohere'
	},
	{
		id: 'mistral',
		label: 'Mistral',
		apiKeyStorageKey: 'MISTRAL_API_SECRET',
		apiKeyLabel: 'Mistral API key',
		apiKeyPlaceholder: '...',
		apiKeyRequired: true,
		modelStorageKey: 'MISTRAL_MODEL',
		defaultModel: 'mistral-large-latest',
		catalogProviderId: 'mistral'
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		apiKeyStorageKey: 'OPENROUTER_API_SECRET',
		apiKeyLabel: 'OpenRouter API key',
		apiKeyPlaceholder: 'sk-or-v1-...',
		apiKeyRequired: true,
		modelStorageKey: 'OPENROUTER_MODEL',
		defaultModel: 'gpt-5-mini',
		catalogProviderId: 'openrouter'
	},
	{
		id: 'ollama',
		label: 'Ollama',
		apiKeyRequired: false,
		modelStorageKey: 'OLLAMA_MODEL',
		defaultModel: 'llama2:latest',
		catalogProviderId: 'ollama',
		baseURLStorageKey: 'OLLAMA_BASE_URL',
		defaultBaseURL: 'http://localhost:11434',
		baseURLLabel: 'Ollama URL'
	},
	{
		id: 'openai-compatible',
		label: 'OpenAI-compatible',
		apiKeyStorageKey: 'OPENAI_COMPATIBLE_API_SECRET',
		apiKeyLabel: 'API key (optional)',
		apiKeyPlaceholder: 'API key',
		apiKeyRequired: false,
		modelStorageKey: 'OPENAI_COMPATIBLE_MODEL',
		defaultModel: '',
		baseURLStorageKey: 'OPENAI_COMPATIBLE_BASE_URL',
		defaultBaseURL: '',
		baseURLLabel: 'Base URL'
	}
];

const providerConfigById = new Map(providerConfigs.map((provider) => [provider.id, provider]));

export function isProviderId(value: string | undefined): value is ProviderId {
	return value !== undefined && providerConfigById.has(value as ProviderId);
}

export function getProviderConfig(providerId: ProviderId): ProviderConfig {
	const provider = providerConfigById.get(providerId);
	if (!provider) throw new Error(`Unknown provider: ${providerId}`);
	return provider;
}

export function getSelectedProviderId(values: Record<string, string>): ProviderId {
	const providerId = values.LLM_PROVIDER;
	return isProviderId(providerId) ? providerId : 'openai';
}

export function getProviderModel(provider: ProviderConfig, values: Record<string, string>): string {
	const storedModel = values[provider.modelStorageKey]?.trim() || provider.defaultModel;
	if (!storedModel || !provider.catalogProviderId) return storedModel;

	const modelFromProviderId = providerAwareModels.fromProviderId?.(
		provider.catalogProviderId,
		storedModel
	);
	if (modelFromProviderId) return modelFromProviderId.id;

	const catalogModel = models.id(storedModel);
	if (getCatalogModelIdForProvider(catalogModel, provider.catalogProviderId)) {
		return catalogModel?.id ?? storedModel;
	}

	// A known catalog model may have been removed from this provider after it
	// was saved. Fall back instead of preserving a provider-invalid selection.
	if (catalogModel) {
		const defaultModel = models.id(provider.defaultModel);
		if (getCatalogModelIdForProvider(defaultModel, provider.catalogProviderId)) {
			return defaultModel?.id ?? provider.defaultModel;
		}

		return getProviderModels(provider)[0]?.id ?? storedModel;
	}

	return storedModel;
}

export function getProviderModels(provider: ProviderConfig): Model[] {
	if (!provider.catalogProviderId) return [];
	return Array.from(models.fromProvider(provider.catalogProviderId).canChat());
}

export function getModelIdForProvider(provider: ProviderConfig, canonicalModelId: string): string {
	if (!provider.catalogProviderId) return canonicalModelId;

	const resolvedModelId = providerAwareModels.resolveModelIdForProvider?.(
		canonicalModelId,
		provider.catalogProviderId
	);
	if (resolvedModelId) return resolvedModelId;

	const catalogModel = models.id(canonicalModelId);
	const resolvedByModel = getCatalogModelIdForProvider(catalogModel, provider.catalogProviderId);
	if (resolvedByModel) return resolvedByModel;

	// Older aimodels releases predate the conversion API. Keep OpenRouter
	// usable during the transition, while preferring the catalog mapping above.
	if (provider.catalogProviderId === 'openrouter' && catalogModel?.creatorId) {
		return `${catalogModel.creatorId}/${catalogModel.id}`;
	}

	return canonicalModelId;
}

function getCatalogModelIdForProvider(
	model: Model | undefined,
	providerId: string
): string | undefined {
	return (model as ProviderAwareModel | undefined)?.idFor?.(providerId);
}

export function getProviderBaseURL(
	provider: ProviderConfig,
	values: Record<string, string>
): string {
	if (!provider.baseURLStorageKey) return '';
	return values[provider.baseURLStorageKey]?.trim() || provider.defaultBaseURL || '';
}

export function isProviderConfigured(
	provider: ProviderConfig,
	values: Record<string, string>
): boolean {
	if (
		provider.apiKeyRequired &&
		(!provider.apiKeyStorageKey || !values[provider.apiKeyStorageKey]?.trim())
	) {
		return false;
	}

	if (!getProviderModel(provider, values)) return false;
	if (provider.baseURLStorageKey && !getProviderBaseURL(provider, values)) return false;

	return true;
}

export function createLanguageProvider(
	providerId: ProviderId,
	values: Record<string, string>,
	options: { optimizeForLatency?: boolean } = {}
): LanguageProvider {
	const provider = getProviderConfig(providerId);
	const apiKey = provider.apiKeyStorageKey ? values[provider.apiKeyStorageKey]?.trim() || '' : '';
	const model = getModelIdForProvider(provider, getProviderModel(provider, values));

	switch (providerId) {
		case 'openai':
			return Lang.openai({
				apiKey,
				model,
				reasoningEffort: options.optimizeForLatency ? 'low' : 'high',
				showReasoningSummary: !options.optimizeForLatency
			});
		case 'anthropic':
			return Lang.anthropic({ apiKey, model });
		case 'google':
			return Lang.google({ apiKey, model });
		case 'groq':
			return Lang.groq({ apiKey, model });
		case 'deepseek':
			return Lang.deepseek({ apiKey, model });
		case 'kimi':
			return Lang.kimi({ apiKey, model });
		case 'xai':
			return Lang.xai({ apiKey, model });
		case 'cohere':
			return Lang.cohere({ apiKey, model });
		case 'mistral':
			return Lang.mistral({ apiKey, model });
		case 'openrouter':
			return Lang.openrouter({
				apiKey,
				model,
				bodyProperties: options.optimizeForLatency
					? { provider: { sort: 'latency' } }
					: undefined
			});
		case 'ollama':
			return Lang.ollama({ model, url: getProviderBaseURL(provider, values) });
		case 'openai-compatible':
			return Lang.openaiLike({
				apiKey: apiKey || undefined,
				model,
				baseURL: getProviderBaseURL(provider, values)
			});
	}
}
