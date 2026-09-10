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
	apiKeyEnvironmentKey?: string;
	apiKeyRequired: boolean;
	modelStorageKey: string;
	defaultModel: string;
	catalogProviderId?: string;
	baseURLEnvironmentKey?: string;
	defaultBaseURL?: string;
	supportsOpenAIBuiltInTools?: boolean;
};

// Deliberate playground defaults, independent of catalog ordering and library defaults.
// Reviewed September 2026; see playground/README.md for sources and override precedence.
export const providerConfigs: ProviderConfig[] = [
	{
		id: 'openai',
		label: 'OpenAI',
		apiKeyEnvironmentKey: 'OPENAI_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'OPENAI_MODEL',
		defaultModel: 'gpt-5.6-sol',
		catalogProviderId: 'openai',
		supportsOpenAIBuiltInTools: true
	},
	{
		id: 'anthropic',
		label: 'Anthropic',
		apiKeyEnvironmentKey: 'ANTHROPIC_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'ANTHROPIC_MODEL',
		defaultModel: 'claude-sonnet-5',
		catalogProviderId: 'anthropic'
	},
	{
		id: 'google',
		label: 'Google Gemini',
		apiKeyEnvironmentKey: 'GOOGLE_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'GOOGLE_MODEL',
		defaultModel: 'gemini-3.8-flash',
		catalogProviderId: 'google'
	},
	{
		id: 'groq',
		label: 'Groq',
		apiKeyEnvironmentKey: 'GROQ_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'GROQ_MODEL',
		defaultModel: 'gpt-oss-120b',
		catalogProviderId: 'groq'
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		apiKeyEnvironmentKey: 'DEEPSEEK_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'DEEPSEEK_MODEL',
		defaultModel: 'deepseek-flash',
		catalogProviderId: 'deepseek'
	},
	{
		id: 'kimi',
		label: 'Kimi',
		apiKeyEnvironmentKey: 'KIMI_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'KIMI_MODEL',
		defaultModel: 'kimi-k3',
		catalogProviderId: 'kimi'
	},
	{
		id: 'xai',
		label: 'xAI',
		apiKeyEnvironmentKey: 'XAI_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'XAI_MODEL',
		defaultModel: 'grok-4.6',
		catalogProviderId: 'xai'
	},
	{
		id: 'cohere',
		label: 'Cohere',
		apiKeyEnvironmentKey: 'COHERE_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'COHERE_MODEL',
		defaultModel: 'command-a-plus-05-2026',
		catalogProviderId: 'cohere'
	},
	{
		id: 'mistral',
		label: 'Mistral',
		apiKeyEnvironmentKey: 'MISTRAL_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'MISTRAL_MODEL',
		defaultModel: 'mistral-medium-3-5',
		catalogProviderId: 'mistral'
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		apiKeyEnvironmentKey: 'OPENROUTER_API_KEY',
		apiKeyRequired: true,
		modelStorageKey: 'OPENROUTER_MODEL',
		defaultModel: 'gpt-5.6-sol',
		catalogProviderId: 'openrouter'
	},
	{
		id: 'ollama',
		label: 'Ollama',
		apiKeyRequired: false,
		modelStorageKey: 'OLLAMA_MODEL',
		defaultModel: 'qwen3.5:4b',
		catalogProviderId: 'ollama',
		baseURLEnvironmentKey: 'OLLAMA_BASE_URL',
		defaultBaseURL: 'http://localhost:11434'
	},
	{
		id: 'openai-compatible',
		label: 'OpenAI-compatible',
		apiKeyEnvironmentKey: 'OPENAI_COMPATIBLE_API_KEY',
		apiKeyRequired: false,
		modelStorageKey: 'OPENAI_COMPATIBLE_MODEL',
		defaultModel: '',
		baseURLEnvironmentKey: 'OPENAI_COMPATIBLE_BASE_URL',
		defaultBaseURL: ''
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

export function getProviderModel(
	provider: ProviderConfig,
	values: Record<string, string>,
	defaultModel = provider.defaultModel
): string {
	const storedModel = values[provider.modelStorageKey]?.trim() || defaultModel;
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
	if (!provider.baseURLEnvironmentKey) return '';
	return values[provider.baseURLEnvironmentKey]?.trim() || provider.defaultBaseURL || '';
}

export function createLanguageProvider(
	providerId: ProviderId,
	values: Record<string, string>,
	options: { optimizeForLatency?: boolean } = {}
): LanguageProvider {
	const provider = getProviderConfig(providerId);
	const apiKey = provider.apiKeyEnvironmentKey
		? values[provider.apiKeyEnvironmentKey]?.trim() || ''
		: '';
	const model = getModelIdForProvider(provider, getProviderModel(provider, values));
	const maxTokens = options.optimizeForLatency ? 256 : undefined;

	switch (providerId) {
		case 'openai':
			return Lang.openai({
				apiKey,
				model,
				reasoningEffort: options.optimizeForLatency ? 'low' : 'high',
				showReasoningSummary: !options.optimizeForLatency,
				defaultOptions: options.optimizeForLatency
					? { providerSpecificBody: { max_output_tokens: maxTokens } }
					: undefined
			});
		case 'anthropic':
			return Lang.anthropic({
				apiKey,
				model,
				maxTokens,
				defaultOptions: options.optimizeForLatency
					? { providerSpecificBody: { thinking: { type: 'disabled' } } }
					: undefined
			});
		case 'google':
			return Lang.google({ apiKey, model, maxTokens });
		case 'groq':
			return Lang.groq({
				apiKey,
				model,
				maxTokens,
				reasoningEffort: options.optimizeForLatency ? 'low' : undefined,
				includeReasoning: options.optimizeForLatency ? false : undefined
			});
		case 'deepseek':
			return Lang.deepseek({
				apiKey,
				model,
				maxTokens,
				defaultOptions: options.optimizeForLatency
					? { providerSpecificBody: { thinking: { type: 'disabled' } } }
					: undefined
			});
		case 'kimi':
			return Lang.kimi({
				apiKey,
				model,
				maxTokens,
				thinking: options.optimizeForLatency ? { type: 'disabled' } : undefined,
				bodyProperties: options.optimizeForLatency
					? { max_completion_tokens: maxTokens }
					: undefined
			});
		case 'xai':
			return Lang.xai({ apiKey, model, maxTokens });
		case 'cohere':
			return Lang.cohere({ apiKey, model, maxTokens });
		case 'mistral':
			return Lang.mistral({ apiKey, model, maxTokens });
		case 'openrouter':
			return Lang.openrouter({
				apiKey,
				model,
				maxTokens,
				bodyProperties: options.optimizeForLatency
					? {
							provider: { sort: 'latency' },
							reasoning: { effort: 'none' }
						}
					: undefined
			});
		case 'ollama':
			return Lang.ollama({ model, maxTokens, url: getProviderBaseURL(provider, values) });
		case 'openai-compatible':
			return Lang.openaiLike({
				apiKey: apiKey || undefined,
				model,
				maxTokens,
				baseURL: getProviderBaseURL(provider, values)
			});
	}
}
