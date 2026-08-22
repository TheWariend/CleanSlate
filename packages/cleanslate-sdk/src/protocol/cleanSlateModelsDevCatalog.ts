/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, ICleanSlateModelsDevModelMetadata } from './cleanSlateAI.js';

/**
 * Shared models.dev catalog handling.
 *
 * The catalog supplies per-model facts the local capability tables cannot know: which reasoning
 * efforts a model actually accepts, its release date, context/output limits and pricing.
 * `resolveCleanSlateModelCapabilities` reads `reasoningEfforts` from here to populate
 * `supportedReasoningEfforts`, so a host that cannot fetch the catalog reports a model as having
 * no reasoning options at all — which is how the terminal host ended up never sending
 * `reasoning_effort`.
 *
 * Only the pure parts live here (URL, cache policy, provider-key mapping, entry parsing). Fetching
 * stays with each host, because they have genuinely different transports: the workbench routes
 * through its request service to honour editor proxy and certificate settings, while the terminal
 * uses the SDK Node transport that applies HTTP_PROXY, HTTPS_PROXY, and NO_PROXY.
 */

export const MODELS_DEV_CATALOG_URL = 'https://models.dev/api.json';
export const MODELS_DEV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Catalog keys to consult for a CleanSlate provider, in priority order. */
export function modelsDevProviderKeys(provider: AIProvider): string[] {
	switch (provider) {
		case 'azureOpenAI': return ['azure', 'openai'];
		case 'bedrock': return ['amazon-bedrock', 'anthropic'];
		case 'openrouter': return ['openrouter'];
		case 'anthropic': return ['anthropic'];
		case 'openai': return ['openai'];
		case 'custom':
			// models.dev indexes Sarvam's OpenAI-compatible API under its own key.
			return ['sarvam', provider];
		default: return [provider];
	}
}

const ALLOWED_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function positiveInteger(value: unknown): number | undefined {
	return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function nonNegativeFinite(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Converts one raw catalog entry into CleanSlate's metadata shape. */
export function toModelsDevMetadata(provider: string, model: string, entry: any): ICleanSlateModelsDevModelMetadata | undefined {
	if (!entry || typeof entry !== 'object') {
		return undefined;
	}
	const effortOption = Array.isArray(entry.reasoning_options)
		? entry.reasoning_options.find((option: any) => option?.type === 'effort')
		: undefined;
	const reasoningEfforts = Array.isArray(effortOption?.values)
		? effortOption.values.filter((value: unknown) => typeof value === 'string' && ALLOWED_REASONING_EFFORTS.has(value))
		: undefined;
	return {
		id: typeof entry.id === 'string' ? entry.id : model,
		provider,
		releaseDate: typeof entry.release_date === 'string' ? entry.release_date : undefined,
		reasoning: typeof entry.reasoning === 'boolean' ? entry.reasoning : undefined,
		reasoningEfforts,
		toolCall: typeof entry.tool_call === 'boolean' ? entry.tool_call : undefined,
		structuredOutput: typeof entry.structured_output === 'boolean' ? entry.structured_output : undefined,
		temperature: typeof entry.temperature === 'boolean' ? entry.temperature : undefined,
		contextWindowTokens: positiveInteger(entry.limit?.context),
		maxInputTokens: positiveInteger(entry.limit?.input),
		maxOutputTokens: positiveInteger(entry.limit?.output),
		inputCostPer1MTokens: nonNegativeFinite(entry.cost?.input),
		outputCostPer1MTokens: nonNegativeFinite(entry.cost?.output),
		cacheReadCostPer1MTokens: nonNegativeFinite(entry.cost?.cache_read),
		cacheWriteCostPer1MTokens: nonNegativeFinite(entry.cost?.cache_write)
	};
}

/** Looks a model up across every catalog key that maps to `provider`. */
export function findModelsDevMetadata(
	catalog: Record<string, any> | undefined,
	provider: AIProvider,
	model: string
): ICleanSlateModelsDevModelMetadata | undefined {
	const normalizedModel = model.trim();
	if (!normalizedModel || !catalog) {
		return undefined;
	}
	for (const providerKey of modelsDevProviderKeys(provider)) {
		const metadata = toModelsDevMetadata(providerKey, normalizedModel, catalog[providerKey]?.models?.[normalizedModel]);
		if (metadata) {
			return metadata;
		}
	}

	return undefined;
}

/** True when a parsed response is a usable catalog object. */
export function isValidModelsDevCatalog(parsed: unknown): parsed is Record<string, any> {
	return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
}
