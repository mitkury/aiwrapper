import { models, type Model } from 'aiwrapper';
import { describe, expect, it } from 'vitest';
import {
	getModelIdForProvider,
	getProviderConfig,
	getProviderModel,
	getProviderModels
} from './provider-config.js';

describe('chat provider configuration', () => {
	const openRouter = getProviderConfig('openrouter');

	it('only offers catalog models exposed by OpenRouter', () => {
		const providerModels = getProviderModels(openRouter);

		expect(providerModels.length).toBeGreaterThan(0);
		expect(providerModels.every((model) => model.canChat())).toBe(true);
		expect(
			providerModels.every((model) =>
				model.providers.some((provider) => provider.id === 'openrouter')
			)
		).toBe(true);
	});

	it('falls back when a saved catalog model is no longer exposed', () => {
		const providerModelIds = new Set(getProviderModels(openRouter).map((model) => model.id));
		const unavailableModel = Array.from(models).find(
			(model) => model.canChat() && !providerModelIds.has(model.id)
		);
		expect(unavailableModel).toBeDefined();

		const selected = getProviderModel(openRouter, {
			OPENROUTER_MODEL: unavailableModel?.id ?? ''
		});

		expect(providerModelIds.has(selected)).toBe(true);
	});

	it('resolves canonical catalog IDs at the request boundary', () => {
		const model = getProviderModels(openRouter).find((candidate) =>
			Boolean(expectedOpenRouterId(candidate))
		);
		expect(model).toBeDefined();

		expect(getModelIdForProvider(openRouter, model?.id ?? '')).toBe(expectedOpenRouterId(model));
	});
});

function expectedOpenRouterId(model: Model | undefined): string | undefined {
	if (!model) return undefined;
	const providerAwareModel = model as Model & {
		idFor?: (providerId: string) => string | undefined;
	};
	return (
		providerAwareModel.idFor?.('openrouter') ??
		(model.creatorId ? `${model.creatorId}/${model.id}` : undefined)
	);
}
