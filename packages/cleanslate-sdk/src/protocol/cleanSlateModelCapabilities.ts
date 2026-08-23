/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, CLEANSLATE_REASONING_LEVELS, CleanSlateReasoningLevel, ICleanSlateModelsDevModelMetadata, isCleanSlateReasoningLevel } from './cleanSlateAI.js';

export type CleanSlateOpenAICompatibleProviderFlavor = 'openai' | 'xai' | 'nvidia' | 'openrouter' | 'custom' | 'azureOpenAI' | 'azureFoundry';
export type CleanSlateProviderReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type CleanSlateModelFamily =
	| 'openai-reasoning'
	| 'openai-chat'
	| 'openai-compatible-chat'
	| 'grok'
	| 'kimi'
	| 'deepseek'
	| 'qwen'
	| 'glm'
	| 'minimax'
	| 'mistral'
	| 'llama'
	| 'cohere'
	| 'nemotron'
	| 'claude'
	| 'gemini'
	| 'gemma'
	| 'bedrock'
	| 'unknown';

export interface ICleanSlateModelCapabilityRequest {
	provider: AIProvider;
	model?: string;
	modelReleaseDate?: string;
	flavor?: CleanSlateOpenAICompatibleProviderFlavor;
	planMode?: boolean;
	reasoningLevel?: CleanSlateReasoningLevel;
	configuredMaxOutputTokens?: number;
	sessionId?: string;
	modelsDevMetadata?: ICleanSlateModelsDevModelMetadata;
}

export interface ICleanSlateModelCapabilities {
	provider: AIProvider;
	model?: string;
	flavor?: CleanSlateOpenAICompatibleProviderFlavor;
	family: CleanSlateModelFamily;
	nativeToolCalls: boolean;
	openAICompatibleThirdParty: boolean;
	useMaxCompletionTokens: boolean;
	useResponsesApi?: boolean;
	includeSamplingParameters: boolean;
	temperature?: number;
	topP?: number;
	topK?: number;
	reasoningEffort?: CleanSlateProviderReasoningEffort;
	supportedReasoningEfforts?: CleanSlateProviderReasoningEffort[];
	reasoningSummary?: 'auto';
	parallelToolCalls?: boolean;
	store?: boolean;
	promptCacheKey?: string;
	include?: string[];
	bodyOptions?: Record<string, any>;
	thinkingConfig?: Record<string, any>;
	thinking?: Record<string, any>;
	additionalModelRequestFields?: Record<string, any>;
	suppressReasoningContent?: boolean;
	maxOutputTokens: number;
	/**
	 * CleanSlate's usable prompt/input budget after provider-specific reserves.
	 */
	contextWindowTokens?: number;
	/**
	 * The model/provider advertised context window before output reservations.
	 */
	modelContextWindowTokens?: number;
	/**
	 * The model/provider advertised output limit before CleanSlate caps request output.
	 */
	modelMaxOutputTokens?: number;
	/**
	 * Maximum input tokens CleanSlate should plan around before its own reserve.
	 */
	maxInputTokens?: number;
	autoCompactReserveTokens?: number;
}

export interface ICleanSlateReasoningLevelOption {
	level: CleanSlateReasoningLevel;
	enabled: boolean;
	native: boolean;
	disabledReason?: string;
}

interface ICleanSlateContextLimits {
	modelContextWindowTokens: number;
	maxInputTokens?: number;
	effectiveContextWindowTokens?: number;
}

interface ICleanSlateModelLimitProfile extends ICleanSlateContextLimits {
	modelMaxOutputTokens?: number;
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS;
const MIN_CONTEXT_WINDOW_TOKENS = 1024;
const DEFAULT_KNOWN_INPUT_BUFFER_TOKENS = 20_000;
const DEFAULT_REQUEST_OUTPUT_CAP_TOKENS = 32_000;
const DEFAULT_MODEL_OUTPUT_TOKENS = 16_384;
const MODEL_LIMITS = {
	openai: {
		gpt5: { modelContextWindowTokens: 400_000, maxInputTokens: 272_000, modelMaxOutputTokens: 128_000 },
		gpt5Long: { modelContextWindowTokens: 1_050_000, maxInputTokens: 922_000, modelMaxOutputTokens: 128_000 },
		gpt41: { modelContextWindowTokens: 1_047_576, modelMaxOutputTokens: 32_768 },
		defaultChat: { modelContextWindowTokens: 128_000 }
	},
	claude: {
		default: { modelContextWindowTokens: 200_000, modelMaxOutputTokens: 64_000 },
		long: { modelContextWindowTokens: 1_000_000, modelMaxOutputTokens: 64_000 }
	},
	gemini: {
		default: { modelContextWindowTokens: 128_000 },
		pro15: { modelContextWindowTokens: 1_000_000 },
		long: { modelContextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536 }
	},
	grok: {
		default: { modelContextWindowTokens: 256_000, modelMaxOutputTokens: 30_000 },
		grok4: { modelContextWindowTokens: 1_000_000, modelMaxOutputTokens: 30_000 },
		grok420: { modelContextWindowTokens: 2_000_000, modelMaxOutputTokens: 30_000 }
	},
	qwen: {
		default: { modelContextWindowTokens: 128_000, modelMaxOutputTokens: 32_000 },
		coder: { modelContextWindowTokens: 262_144, modelMaxOutputTokens: 32_000 },
		max: { modelContextWindowTokens: 262_144, modelMaxOutputTokens: 65_536 },
		plus: { modelContextWindowTokens: 1_000_000, modelMaxOutputTokens: 32_000 }
	},
	kimi: {
		default: { modelContextWindowTokens: 256_000, modelMaxOutputTokens: 32_000 },
		k8: { modelContextWindowTokens: 8_192, modelMaxOutputTokens: 32_000 },
		k32: { modelContextWindowTokens: 32_768, modelMaxOutputTokens: 32_000 },
		k128: { modelContextWindowTokens: 131_072, modelMaxOutputTokens: 32_000 },
		k25: { modelContextWindowTokens: 256_000, modelMaxOutputTokens: 262_144 }
	},
	deepseek: {
		default: { modelContextWindowTokens: 64_000, modelMaxOutputTokens: 32_000 },
		// DeepSeek V4 (Flash and Pro) serve a 1M-token context window; Flash
		// supports up to 384K output tokens (requests are still clamped by
		// DEFAULT_REQUEST_OUTPUT_CAP_TOKENS).
		v4: { modelContextWindowTokens: 1_000_000, modelMaxOutputTokens: 384_000 }
	},
	glm: {
		default: { modelContextWindowTokens: 128_000 }
	},
	minimax: {
		default: { modelContextWindowTokens: 128_000, modelMaxOutputTokens: 32_000 },
		m2: { modelContextWindowTokens: 200_000, modelMaxOutputTokens: 32_000 }
	},
	mistral: {
		default: { modelContextWindowTokens: 128_000 },
		mixtral8x7b: { modelContextWindowTokens: 32_768, modelMaxOutputTokens: 16_384 },
		mixtral8x22b: { modelContextWindowTokens: 65_536, modelMaxOutputTokens: 13_108 }
	},
	llama: {
		default: { modelContextWindowTokens: 128_000 }
	},
	cohere: {
		default: { modelContextWindowTokens: 128_000 },
		commandA: { modelContextWindowTokens: 256_000 }
	},
	nemotron: {
		default: { modelContextWindowTokens: 128_000, modelMaxOutputTokens: 32_000 },
		ultra550b: { modelContextWindowTokens: 1_000_000, modelMaxOutputTokens: 65_536 }
	}
} as const satisfies Record<string, Record<string, ICleanSlateModelLimitProfile>>;
const HIGH_CONTEXT_THRESHOLD_TOKENS = 100_000;
const DEFAULT_GLOBAL_CONTEXT_BUDGET_CHARS = 20_000;
const HIGH_CONTEXT_GLOBAL_BUDGET_CHARS = 120_000;
const HIGH_CONTEXT_LOW_REASONING_GLOBAL_BUDGET_CHARS = 80_000;
const OPENAI_REASONING_GLOBAL_BUDGET_CHARS = 80_000;
const OPENAI_REASONING_LOW_GLOBAL_BUDGET_CHARS = 48_000;
const DEFAULT_FILE_TRUNCATION_CHARS = 4_000;
const HIGH_CONTEXT_FILE_TRUNCATION_CHARS = 12_000;
const HIGH_CONTEXT_LOW_REASONING_FILE_TRUNCATION_CHARS = 8_000;
const OPENAI_REASONING_FILE_TRUNCATION_CHARS = 8_000;
const OPENAI_REASONING_LOW_FILE_TRUNCATION_CHARS = 6_000;
const WIDELY_SUPPORTED_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['low', 'medium', 'high'];
// OpenAI request tuning: reasoning-effort availability and request-shape gates.
const OPENAI_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['none', 'minimal', ...WIDELY_SUPPORTED_EFFORTS, 'xhigh'];
const OPENAI_GPT5_1_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['none', ...WIDELY_SUPPORTED_EFFORTS];
const OPENAI_GPT5_2_PLUS_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = [...OPENAI_GPT5_1_EFFORTS, 'xhigh'];
const OPENAI_GPT5_6_PLUS_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = [...OPENAI_GPT5_2_PLUS_EFFORTS, 'max'];
const ANTHROPIC_FABLE_5_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const SARVAM_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = WIDELY_SUPPORTED_EFFORTS;
const GLM_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = [...WIDELY_SUPPORTED_EFFORTS, 'xhigh', 'max'];
const OPENAI_GPT5_PRO_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['high'];
const OPENAI_GPT5_PRO_2_PLUS_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['medium', 'high', 'xhigh'];
const OPENAI_GPT5_CHAT_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['medium'];
const OPENAI_GPT5_CODEX_XHIGH_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = [...WIDELY_SUPPORTED_EFFORTS, 'xhigh'];
const OPENAI_GPT5_CODEX_3_PLUS_EFFORTS: readonly CleanSlateProviderReasoningEffort[] = ['none', ...OPENAI_GPT5_CODEX_XHIGH_EFFORTS];
const OPENAI_NONE_EFFORT_RELEASE_DATE = '2025-11-13';
const OPENAI_XHIGH_EFFORT_RELEASE_DATE = '2025-12-04';
// Z.ai added reasoning_effort with GLM-5.2 (2026-02); earlier GLM releases only expose
// the thinking on/off switch, not effort gradations.
const GLM_REASONING_EFFORT_RELEASE_DATE = '2026-01-15';
const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/;
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/;
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/;
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/;

export interface ICleanSlateContextDefaultsRequest extends ICleanSlateModelCapabilityRequest {
	configuredContextWindowTokens?: number;
	configuredGlobalContextBudgetChars?: number;
	configuredFileTruncationChars?: number;
}

export interface ICleanSlateContextDefaults {
	contextWindowTokens: number;
	modelContextWindowTokens: number;
	modelMaxOutputTokens: number;
	maxInputTokens: number;
	autoCompactReserveTokens: number;
	globalContextBudgetChars: number;
	fileTruncationChars: number;
}

export function getCleanSlateOutputTokenBudget(
	reasoningLevel: CleanSlateReasoningLevel | undefined,
	configuredMaxOutputTokens: number | undefined
): number {
	void reasoningLevel;

	const configured = Number.isFinite(configuredMaxOutputTokens) && configuredMaxOutputTokens! > 0
		? Math.floor(configuredMaxOutputTokens!)
		: undefined;

	if (configured === undefined) {
		return DEFAULT_REQUEST_OUTPUT_CAP_TOKENS;
	}

	return configured;
}

export function resolveCleanSlateModelCapabilities(request: ICleanSlateModelCapabilityRequest): ICleanSlateModelCapabilities {
	const effectiveRequest = request.modelReleaseDate || !request.modelsDevMetadata?.releaseDate
		? request
		: { ...request, modelReleaseDate: request.modelsDevMetadata.releaseDate };
	const family = resolveCleanSlateModelFamily(effectiveRequest.provider, effectiveRequest.model);
	const openAICompatibleThirdParty = isOpenAICompatibleThirdPartyFamily(family);
	const modelLimits = inferModelLimitProfile(family, effectiveRequest.model, effectiveRequest.modelsDevMetadata);
	const modelMaxOutputTokens = modelLimits.modelMaxOutputTokens ?? DEFAULT_MODEL_OUTPUT_TOKENS;
	const modelTuning = resolveCleanSlateProviderTuning(effectiveRequest, family);
	if (effectiveRequest.modelsDevMetadata?.reasoningEfforts?.length) {
		modelTuning.supportedReasoningEfforts = [...effectiveRequest.modelsDevMetadata.reasoningEfforts];
	}
	if (effectiveRequest.modelsDevMetadata?.temperature === false) {
		modelTuning.temperature = undefined;
		modelTuning.topP = undefined;
	}
	const maxOutputTokens = resolveCleanSlateMaxOutputTokens(effectiveRequest, family);
	const useMaxCompletionTokens = modelTuning.useMaxCompletionTokens ?? (family === 'openai-reasoning' && isOpenAICompatibleEndpoint(request.provider, request.flavor));
	const azureOpenAIModelEndpoint = isAzureOpenAIModelEndpoint(request.provider, request.flavor, family);
	const normalizedContextLimits = normalizeContextLimits(modelLimits, modelMaxOutputTokens);

	return {
		provider: request.provider,
		model: request.model,
		flavor: request.flavor,
		family,
		nativeToolCalls: effectiveRequest.modelsDevMetadata?.toolCall ?? supportsNativeToolCalls(effectiveRequest.provider, family),
		openAICompatibleThirdParty,
		useMaxCompletionTokens,
		useResponsesApi: modelTuning.useResponsesApi,
		includeSamplingParameters: shouldIncludeSamplingParameters(request.flavor, useMaxCompletionTokens),
		temperature: modelTuning.temperature,
		topP: modelTuning.topP,
		topK: modelTuning.topK,
		reasoningEffort: useMaxCompletionTokens
			? (modelTuning.reasoningEffort ?? (modelTuning.suppressDefaultReasoningEffort ? undefined : resolveReasoningEffort(getRequestReasoningLevel(request), azureOpenAIModelEndpoint)))
			: modelTuning.reasoningEffort,
	supportedReasoningEfforts: modelTuning.supportedReasoningEfforts,
	reasoningSummary: modelTuning.reasoningSummary,
	parallelToolCalls: azureOpenAIModelEndpoint ? true : undefined,
		store: modelTuning.store,
		promptCacheKey: modelTuning.promptCacheKey,
		include: modelTuning.include,
		bodyOptions: modelTuning.bodyOptions,
		thinkingConfig: modelTuning.thinkingConfig,
		thinking: modelTuning.thinking,
		additionalModelRequestFields: modelTuning.additionalModelRequestFields,
		suppressReasoningContent: modelTuning.suppressReasoningContent,
		maxOutputTokens,
		contextWindowTokens: normalizedContextLimits.effectiveContextWindowTokens,
		modelContextWindowTokens: normalizedContextLimits.modelContextWindowTokens,
		modelMaxOutputTokens,
		maxInputTokens: normalizedContextLimits.maxInputTokens,
		autoCompactReserveTokens: normalizedContextLimits.autoCompactReserveTokens
	};
}

export function resolveCleanSlateReasoningLevelOptions(
	request: Omit<ICleanSlateModelCapabilityRequest, 'reasoningLevel'>
): ICleanSlateReasoningLevelOption[] {
	const family = resolveCleanSlateModelFamily(request.provider, request.model);
	const modelId = normalizeModelId(request.model);
	const nativeLevels = resolveCleanSlateNativeReasoningLevels(request, family, modelId);
	const modelLabel = request.model?.trim() || 'Selected model';

	return CLEANSLATE_REASONING_LEVELS.map(level => {
		const native = nativeLevels.has(level);
		const enabled = native || (level === 'none' && !isCleanSlateGpt5Pro(modelId));
		return {
			level,
			enabled,
			native,
			disabledReason: enabled
				? undefined
				: `${modelLabel} does not support ${level} reasoning.`
		};
	});
}

export function resolveCleanSlateEffectiveReasoningLevel(
	request: Pick<ICleanSlateModelCapabilityRequest, 'provider' | 'model' | 'flavor' | 'reasoningLevel' | 'modelReleaseDate'>
): CleanSlateReasoningLevel {
	const requested = getRequestReasoningLevel(request);
	const options = resolveCleanSlateReasoningLevelOptions({
		provider: request.provider,
		model: request.model,
		flavor: request.flavor,
		modelReleaseDate: request.modelReleaseDate
	});
	if (options.some(option => option.level === requested && option.enabled)) {
		return requested;
	}
	return options.find(option => option.enabled)?.level ?? 'low';
}

export function getCleanSlateContextDefaults(request: ICleanSlateContextDefaultsRequest): ICleanSlateContextDefaults {
	const capabilities = resolveCleanSlateModelCapabilities(request);
	const inferredContextWindowTokens = capabilities.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
	const configuredContextWindowTokens = normalizePositiveInteger(request.configuredContextWindowTokens, MIN_CONTEXT_WINDOW_TOKENS);
	const contextWindowTokens = configuredContextWindowTokens ?? inferredContextWindowTokens;
	const modelContextWindowTokens = capabilities.modelContextWindowTokens ?? Math.max(contextWindowTokens, DEFAULT_CONTEXT_WINDOW_TOKENS);
	const modelMaxOutputTokens = capabilities.modelMaxOutputTokens ?? DEFAULT_REQUEST_OUTPUT_CAP_TOKENS;
	const maxInputTokens = configuredContextWindowTokens ?? capabilities.maxInputTokens ?? Math.max(contextWindowTokens, DEFAULT_CONTEXT_WINDOW_TOKENS);
	const autoCompactReserveTokens = configuredContextWindowTokens !== undefined
		? 0
		: capabilities.autoCompactReserveTokens ?? resolveInputReserveTokens(modelMaxOutputTokens);
	const highContext = contextWindowTokens >= HIGH_CONTEXT_THRESHOLD_TOKENS;
	const azureOpenAIReasoning = capabilities.family === 'openai-reasoning' && isAzureOpenAIModelEndpoint(request.provider, request.flavor, capabilities.family);
	const requestReasoningLevel = getRequestReasoningLevel(request);
	const lowReasoning = requestReasoningLevel === 'none' || requestReasoningLevel === 'minimal' || requestReasoningLevel === 'low';
	const defaultGlobalBudget = highContext
		? azureOpenAIReasoning
			? (lowReasoning ? OPENAI_REASONING_LOW_GLOBAL_BUDGET_CHARS : OPENAI_REASONING_GLOBAL_BUDGET_CHARS)
			: (lowReasoning ? HIGH_CONTEXT_LOW_REASONING_GLOBAL_BUDGET_CHARS : HIGH_CONTEXT_GLOBAL_BUDGET_CHARS)
		: DEFAULT_GLOBAL_CONTEXT_BUDGET_CHARS;
	const defaultFileTruncation = highContext
		? azureOpenAIReasoning
			? (lowReasoning ? OPENAI_REASONING_LOW_FILE_TRUNCATION_CHARS : OPENAI_REASONING_FILE_TRUNCATION_CHARS)
			: (lowReasoning ? HIGH_CONTEXT_LOW_REASONING_FILE_TRUNCATION_CHARS : HIGH_CONTEXT_FILE_TRUNCATION_CHARS)
		: DEFAULT_FILE_TRUNCATION_CHARS;

	return {
		contextWindowTokens,
		modelContextWindowTokens,
		modelMaxOutputTokens,
		maxInputTokens,
		autoCompactReserveTokens,
		globalContextBudgetChars: normalizePositiveInteger(request.configuredGlobalContextBudgetChars, 2000)
			?? Math.min(contextWindowTokens * 4, defaultGlobalBudget),
		fileTruncationChars: normalizePositiveInteger(request.configuredFileTruncationChars, 500)
			?? defaultFileTruncation
	};
}

export function resolveCleanSlateModelFamily(provider: AIProvider, model: string | undefined): CleanSlateModelFamily {
	const normalized = normalizeModelId(model);

	if (provider === 'anthropic' || normalized.includes('claude')) {
		return 'claude';
	}
	if (provider === 'gemini' || normalized.includes('gemini')) {
		return 'gemini';
	}
	if (normalized.includes('gemma')) {
		// Gemma models (e.g. google/gemma-4-3b-it) are served on NVIDIA NIM and
		// other openai-compatible endpoints. They support OpenAI-compatible tool
		// calling and must not fall through to 'unknown'.
		return 'gemma';
	}
	if (provider === 'bedrock') {
		return 'bedrock';
	}
	if (normalized.includes('grok')) {
		return 'grok';
	}
	if (normalized.includes('kimi') || normalized.includes('moonshot')) {
		return 'kimi';
	}
	if (normalized.includes('deepseek')) {
		return 'deepseek';
	}
	if (normalized.includes('qwen')) {
		return 'qwen';
	}
	if (normalized.includes('glm')) {
		return 'glm';
	}
	if (normalized.includes('minimax')) {
		return 'minimax';
	}
	if (normalized.includes('mistral') || normalized.includes('mixtral')) {
		return 'mistral';
	}
	if (normalized.includes('llama')) {
		return 'llama';
	}
	if (normalized.includes('cohere') || normalized.includes('command-r')) {
		return 'cohere';
	}
	if (normalized.includes('nemotron')) {
		return 'nemotron';
	}
	if (isOpenAIReasoningModel(normalized)) {
		return 'openai-reasoning';
	}
	if (normalized.includes('gpt-oss')) {
		// gpt-oss is frequently hosted behind OpenAI-compatible routes (NVIDIA,
		// OpenRouter, Azure Foundry, local/custom proxies) and can expose hidden
		// reasoning in provider-specific delta fields. Treat it as a reasoning
		// model wherever CleanSlate uses the compatible chat bridge.
		return provider === 'openai' ? 'openai-chat' : 'openai-reasoning';
	}
	if ((provider === 'nvidia' || provider === 'openrouter' || provider === 'custom') && normalized.length > 0) {
		// OpenAI-compatible providers expose chat/tool APIs for many models whose
		// names do not carry a known family marker. Treat those as generic
		// OpenAI-compatible chat models instead of degrading agentic tool execution.
		return 'openai-compatible-chat';
	}
	if (provider === 'openai' || provider === 'azureOpenAI') {
		return 'openai-chat';
	}
	return 'unknown';
}

function normalizeModelId(model: string | undefined): string {
	return (model ?? '').trim().toLowerCase();
}

function getRequestReasoningLevel(request: Pick<ICleanSlateModelCapabilityRequest, 'reasoningLevel'>): CleanSlateReasoningLevel {
	if (isCleanSlateReasoningLevel(request.reasoningLevel)) {
		return request.reasoningLevel;
	}
	return 'low';
}

function isOpenAIReasoningModel(normalizedModel: string): boolean {
	if (!normalizedModel) {
		return false;
	}
	return normalizedModel.includes('gpt-5')
		|| /(?:^|[^0-9])5\.[1-9](?:[^0-9]|$)/.test(normalizedModel)
		|| /(?:^|[^a-z0-9])o[134](?:[^a-z0-9]|$)/.test(normalizedModel);
}

function isOpenAICompatibleThirdPartyFamily(family: CleanSlateModelFamily): boolean {
	return family === 'grok'
		|| family === 'openai-compatible-chat'
		|| family === 'kimi'
		|| family === 'deepseek'
		|| family === 'qwen'
		|| family === 'glm'
		|| family === 'minimax'
		|| family === 'mistral'
		|| family === 'llama'
		|| family === 'cohere'
		|| family === 'nemotron'
		|| family === 'gemma';
}

function isOpenAICompatibleFlavor(flavor: CleanSlateOpenAICompatibleProviderFlavor | undefined): boolean {
	return flavor === 'openai'
		|| flavor === 'xai'
		|| flavor === 'nvidia'
		|| flavor === 'openrouter'
		|| flavor === 'custom'
		|| flavor === 'azureOpenAI'
		|| flavor === 'azureFoundry';
}

function isOpenAICompatibleEndpoint(provider: AIProvider, flavor: CleanSlateOpenAICompatibleProviderFlavor | undefined): boolean {
	return provider === 'openai'
		|| provider === 'azureOpenAI'
		|| provider === 'nvidia'
		|| provider === 'openrouter'
		|| provider === 'custom'
		|| isOpenAICompatibleFlavor(flavor);
}

function isAzureOpenAIModelEndpoint(
	provider: AIProvider,
	flavor: CleanSlateOpenAICompatibleProviderFlavor | undefined,
	family: CleanSlateModelFamily
): boolean {
	return (provider === 'azureOpenAI' || flavor === 'azureOpenAI' || flavor === 'azureFoundry')
		&& (family === 'openai-reasoning' || family === 'openai-chat');
}

function shouldIncludeSamplingParameters(
	flavor: CleanSlateOpenAICompatibleProviderFlavor | undefined,
	useMaxCompletionTokens: boolean
): boolean {
	if (useMaxCompletionTokens) {
		return false;
	}
	// Azure AI Foundry hosts both OpenAI and non-OpenAI models behind an OpenAI-compatible
	// endpoint. Several third-party deployments reject or ignore OpenAI sampling defaults.
	return flavor !== 'azureFoundry';
}

interface ICleanSlateProviderTuning {
	useMaxCompletionTokens?: boolean;
	useResponsesApi?: boolean;
	temperature?: number;
	topP?: number;
	topK?: number;
	reasoningEffort?: CleanSlateProviderReasoningEffort;
	supportedReasoningEfforts?: CleanSlateProviderReasoningEffort[];
	suppressDefaultReasoningEffort?: boolean;
	reasoningSummary?: 'auto';
	store?: boolean;
	promptCacheKey?: string;
	include?: string[];
	bodyOptions?: Record<string, any>;
	thinkingConfig?: Record<string, any>;
	thinking?: Record<string, any>;
	additionalModelRequestFields?: Record<string, any>;
	suppressReasoningContent?: boolean;
}

type CleanSlateProviderAdapter = 'openai' | 'azure' | 'openai-compatible' | 'xai' | 'anthropic' | 'google' | 'amazon-bedrock';

function resolveCleanSlateProviderTuning(request: ICleanSlateModelCapabilityRequest, family: CleanSlateModelFamily): ICleanSlateProviderTuning {
	const modelId = normalizeModelId(request.model);
	const providerID = toCleanSlateProviderID(request.provider, request.flavor);
	const providerAdapter = toCleanSlateProviderAdapter(request.provider, request.flavor);
	const outputLimit = inferOutputTokenLimit(family, request.model);
	const reasoningLevel = getRequestReasoningLevel(request);
	const result: ICleanSlateProviderTuning = {
		temperature: resolveCleanSlateTemperature(modelId),
		topP: resolveCleanSlateTopP(modelId),
		topK: resolveCleanSlateTopK(modelId)
	};

	if (providerID === 'openai' || providerAdapter === 'openai') {
		result.store = false;
	}

	if (providerID === 'cleanslate' && request.sessionId) {
		result.promptCacheKey = request.sessionId;
	}

	if (providerAdapter === 'azure') {
		result.store = false;
		if (request.sessionId) {
			result.promptCacheKey = request.sessionId;
		}
	}

	if (providerID === 'openai' && request.sessionId) {
		result.promptCacheKey = request.sessionId;
	}

	if (providerAdapter === 'google') {
		result.thinkingConfig = resolveCleanSlateGeminiThinkingConfig(request, family, modelId);
	}

	if (providerAdapter === 'anthropic' && (modelId.includes('k2p') || modelId.includes('kimi-k2.') || modelId.includes('kimi-k2p'))) {
		result.thinking = {
			type: 'enabled',
			budgetTokens: Math.max(1024, Math.min(16_000, Math.floor(outputLimit / 2 - 1)))
		};
	}

	if (providerAdapter === 'anthropic' && family === 'claude' && reasoningLevel === 'high' && hasCleanSlateNativeReasoningCapability(family, modelId)) {
		result.thinking = resolveCleanSlateAnthropicThinkingConfig(modelId, outputLimit);
	}
	if (providerAdapter === 'anthropic' && modelId.includes('claude-fable-5')) {
		result.supportedReasoningEfforts = [...ANTHROPIC_FABLE_5_EFFORTS];
	}

	if (family === 'glm') {
		result.supportedReasoningEfforts = resolveCleanSlateGlmReasoningEfforts(modelId, request.modelReleaseDate);
		const glmEffort = resolveCleanSlateGlmReasoningEffort(reasoningLevel, result.supportedReasoningEfforts);
		if (glmEffort) {
			result.reasoningEffort = glmEffort;
		}
	}

	if (isCleanSlateSarvamModel(modelId)) {
		const supportedEfforts = [...SARVAM_EFFORTS];
		result.supportedReasoningEfforts = supportedEfforts;
		result.reasoningEffort = resolveCleanSlateSarvamReasoningEffort(reasoningLevel, supportedEfforts);
	}

	if (providerID.includes('zai') || providerID.includes('zhipuai')) {
		result.bodyOptions = {
			...(result.bodyOptions ?? {}),
			thinking: {
				type: 'enabled',
				clear_thinking: false
			}
		};
	}

	if (providerID === 'alibaba-cn' && hasCleanSlateNativeReasoningCapability(family, modelId) && !modelId.includes('kimi-k2-thinking')) {
		result.bodyOptions = {
			...(result.bodyOptions ?? {}),
			enable_thinking: true
		};
	}

	if (isCleanSlateGpt5Family(modelId)) {
		const supportedEfforts = providerAdapter === 'openai-compatible'
			? resolveCleanSlateOpenAICompatibleReasoningEfforts(modelId)
			: resolveCleanSlateGpt5ReasoningEfforts(modelId, request.modelReleaseDate);
		result.supportedReasoningEfforts = supportedEfforts;
		result.useMaxCompletionTokens = true;
		result.reasoningEffort = resolveCleanSlateGpt5ReasoningEffort(reasoningLevel, modelId, supportedEfforts);
		result.suppressDefaultReasoningEffort = supportedEfforts.length === 0 || !result.reasoningEffort;
		result.useResponsesApi = shouldUseResponsesApiForProvider(providerID, providerAdapter, modelId);
		if (shouldUseOpenAIPriorityProcessing(providerID, modelId)) {
			result.bodyOptions = {
				...(result.bodyOptions ?? {}),
				service_tier: 'priority'
			};
		}
		// Request streamed reasoning summaries wherever the Responses API is used
		// against a first-party OpenAI host — including Azure's v1/Foundry path,
		// whose adapter is 'openai-compatible' but whose providerID is azure-foundry.
		const isFirstPartyOpenAIHost = providerAdapter === 'openai' || providerAdapter === 'azure' || providerID === 'azure-foundry';
		if (result.reasoningEffort && result.reasoningEffort !== 'none' && !isCleanSlateGpt5Pro(modelId) && isFirstPartyOpenAIHost && result.useResponsesApi) {
			result.reasoningSummary = 'auto';
			result.include = ['reasoning.encrypted_content'];
		}

	}

	// OpenRouter normalizes reasoning_effort across backends, so trust the
	// catalog's advertised effort vocabulary for models without a dedicated
	// resolver above (e.g. stealth/ox-alpha exposes low/high/max). The managed
	// CleanSlate proxy speaks the same normalized parameter and serves many of
	// the same models, so its catalog entries map identically. Budget- or
	// thinking-config style families keep their own handling.
	if (
		(providerID === 'openrouter' || providerID === 'cleanslate')
		&& !result.supportedReasoningEfforts
		&& family !== 'claude'
		&& family !== 'gemini'
		&& request.modelsDevMetadata?.reasoningEfforts?.length
	) {
		result.reasoningEffort = resolveCleanSlateCatalogReasoningEffort(reasoningLevel, request.modelsDevMetadata.reasoningEfforts);
	}

	if (providerID === 'grok' && reasoningLevel !== 'none' && hasCleanSlateNativeReasoningCapability(family, modelId)) {
		result.reasoningEffort = reasoningLevel;
	}

	if (providerAdapter === 'amazon-bedrock') {
		const bedrockReasoning = resolveCleanSlateBedrockReasoningConfig(request, modelId, family, outputLimit);
		if (bedrockReasoning) {
			result.additionalModelRequestFields = bedrockReasoning;
		}
	}

	if (providerID === 'nvidia' || (family === 'openai-reasoning' && isOpenAICompatibleEndpoint(request.provider, request.flavor))) {
		result.suppressReasoningContent = true;
	}

	return result;
}

function resolveCleanSlateMaxOutputTokens(request: ICleanSlateModelCapabilityRequest, family: CleanSlateModelFamily): number {
	const advertisedLimit = request.modelsDevMetadata?.maxOutputTokens
		?? inferOutputTokenLimit(family, request.model)
		?? DEFAULT_REQUEST_OUTPUT_CAP_TOKENS;
	const managedOperationalLimit = request.provider === 'cleanslate'
		&& normalizeModelId(request.model).includes('kimi-k2.6')
		? 8_192
		: DEFAULT_REQUEST_OUTPUT_CAP_TOKENS;
	const modelLimit = Math.min(advertisedLimit, managedOperationalLimit, DEFAULT_REQUEST_OUTPUT_CAP_TOKENS);
	const configured = Number.isFinite(request.configuredMaxOutputTokens) && request.configuredMaxOutputTokens! > 0
		? Math.floor(request.configuredMaxOutputTokens!)
		: undefined;
	if (configured !== undefined) {
		return Math.min(configured, modelLimit);
	}

	return modelLimit || DEFAULT_REQUEST_OUTPUT_CAP_TOKENS;
}

function toCleanSlateProviderID(provider: AIProvider, flavor: CleanSlateOpenAICompatibleProviderFlavor | undefined): string {
	if (provider === 'openai') {
		return 'openai';
	}
	if (provider === 'azureOpenAI') {
		return flavor === 'azureFoundry' ? 'azure-foundry' : 'azure';
	}
	if (provider === 'grok') {
		return 'grok';
	}
	if (provider === 'nvidia') {
		return 'nvidia';
	}
	if (provider === 'openrouter') {
		return 'openrouter';
	}
	if (provider === 'custom') {
		return 'custom';
	}
	if (provider === 'anthropic') {
		return 'anthropic';
	}
	if (provider === 'gemini') {
		return 'google';
	}
	if (provider === 'bedrock') {
		return 'amazon-bedrock';
	}
	return provider;
}

function toCleanSlateProviderAdapter(provider: AIProvider, flavor: CleanSlateOpenAICompatibleProviderFlavor | undefined): CleanSlateProviderAdapter {
	if (provider === 'openai') {
		return 'openai';
	}
	if (provider === 'azureOpenAI') {
		return flavor === 'azureFoundry' ? 'openai-compatible' : 'azure';
	}
	if (provider === 'grok') {
		return 'xai';
	}
	if (provider === 'nvidia') {
		return 'openai-compatible';
	}
	if (provider === 'openrouter' || provider === 'custom') {
		return 'openai-compatible';
	}
	if (provider === 'anthropic') {
		return 'anthropic';
	}
	if (provider === 'gemini') {
		return 'google';
	}
	if (provider === 'bedrock') {
		return 'amazon-bedrock';
	}
	return 'openai-compatible';
}

function resolveCleanSlateTemperature(id: string): number | undefined {
	if (id.includes('qwen')) {
		return 0.55;
	}
	if (id.includes('claude')) {
		return undefined;
	}
	if (id.includes('gemini')) {
		return 1.0;
	}
	if (id.includes('glm-4.6') || id.includes('glm-4.7')) {
		return 1.0;
	}
	if (id.includes('minimax-m2')) {
		return 1.0;
	}
	if (id.includes('kimi-k2')) {
		if (['thinking', 'k2.', 'k2p', 'k2-5'].some(value => id.includes(value))) {
			return 1.0;
		}
		return 0.6;
	}
	return undefined;
}

function resolveCleanSlateTopP(id: string): number | undefined {
	if (id.includes('qwen')) {
		return 1;
	}
	if (['minimax-m2', 'gemini', 'kimi-k2.5', 'kimi-k2p5', 'kimi-k2-5'].some(value => id.includes(value))) {
		return 0.95;
	}
	return undefined;
}

function resolveCleanSlateTopK(id: string): number | undefined {
	if (id.includes('minimax-m2')) {
		return ['m2.', 'm25', 'm21'].some(value => id.includes(value)) ? 40 : 20;
	}
	if (id.includes('gemini')) {
		return 64;
	}
	return undefined;
}

function resolveCleanSlateGpt5ReasoningEffort(
	reasoningLevel: CleanSlateReasoningLevel,
	modelId: string,
	supportedEfforts: readonly CleanSlateProviderReasoningEffort[]
): CleanSlateProviderReasoningEffort | undefined {
	if (!supportedEfforts.length) {
		return undefined;
	}
	if (supportedEfforts.includes(reasoningLevel)) {
		return reasoningLevel;
	}
	if (isCleanSlateGpt5Pro(modelId) && (reasoningLevel === 'none' || reasoningLevel === 'low')) {
		return supportedEfforts[0];
	}
	if (reasoningLevel === 'low') {
		return supportedEfforts.includes('minimal')
			? 'minimal'
			: supportedEfforts.includes('none')
				? 'none'
				: undefined;
	}
	return undefined;
}

/**
 * Z.ai accepts the full effort vocabulary on GLM-5.2 but collapses most of it:
 * low/medium run at high, xhigh runs at max, and none/minimal stop thinking.
 * Sending the user's literal choice is safe, so only 'none' is suppressed here —
 * GLM turns thinking off through thinking.type instead.
 */
function resolveCleanSlateGlmReasoningEffort(
	reasoningLevel: CleanSlateReasoningLevel,
	supportedEfforts: readonly CleanSlateProviderReasoningEffort[]
): CleanSlateProviderReasoningEffort | undefined {
	if (!supportedEfforts.length || reasoningLevel === 'none') {
		return undefined;
	}
	if (supportedEfforts.includes(reasoningLevel)) {
		return reasoningLevel;
	}
	return supportedEfforts[supportedEfforts.length - 1];
}

/** Sarvam documents exactly low/medium/high (default medium) for reasoning_effort. */
function resolveCleanSlateSarvamReasoningEffort(
	reasoningLevel: CleanSlateReasoningLevel,
	supportedEfforts: readonly CleanSlateProviderReasoningEffort[]
): CleanSlateProviderReasoningEffort | undefined {
	if (!supportedEfforts.length || reasoningLevel === 'none' || reasoningLevel === 'minimal') {
		return undefined;
	}
	return supportedEfforts.includes(reasoningLevel) ? reasoningLevel : supportedEfforts[0];
}

/**
 * Models.dev catalogs the exact effort vocabulary a model accepts (e.g. ox-alpha
 * exposes low/high/max through OpenRouter). Send the user's literal choice when
 * the catalog lists it, otherwise fall back to the closest advertised effort so
 * catalog-driven models still receive a valid reasoning_effort.
 */
function resolveCleanSlateCatalogReasoningEffort(
	reasoningLevel: CleanSlateReasoningLevel,
	supportedEfforts: readonly CleanSlateProviderReasoningEffort[]
): CleanSlateProviderReasoningEffort | undefined {
	if (!supportedEfforts.length) {
		return undefined;
	}
	if (reasoningLevel === 'none' || reasoningLevel === 'minimal') {
		const noneEffort = supportedEfforts.find(effort => effort === 'none' || effort === 'minimal');
		return noneEffort;
	}
	if (supportedEfforts.includes(reasoningLevel)) {
		return reasoningLevel;
	}
	if (reasoningLevel === 'low') {
		return supportedEfforts[0];
	}
	return supportedEfforts[supportedEfforts.length - 1];
}

function resolveCleanSlateNativeReasoningLevels(
	request: Omit<ICleanSlateModelCapabilityRequest, 'reasoningLevel'>,
	family: CleanSlateModelFamily,
	modelId: string
): Set<CleanSlateReasoningLevel> {
	const levels = new Set<CleanSlateReasoningLevel>();
	const providerID = toCleanSlateProviderID(request.provider, request.flavor);
	const providerAdapter = toCleanSlateProviderAdapter(request.provider, request.flavor);

	if (isCleanSlateGpt5Family(modelId)) {
		const supportedEfforts = providerAdapter === 'openai-compatible'
			? resolveCleanSlateOpenAICompatibleReasoningEfforts(modelId)
			: resolveCleanSlateGpt5ReasoningEfforts(modelId, request.modelReleaseDate);
		for (const level of CLEANSLATE_REASONING_LEVELS) {
			if (supportedEfforts.includes(level)) {
				levels.add(level);
			}
		}
		return levels;
	}

	if (family === 'openai-reasoning' && isOpenAICompatibleEndpoint(request.provider, request.flavor)) {
		for (const level of ['none', ...WIDELY_SUPPORTED_EFFORTS] as const) {
			levels.add(level);
		}
		return levels;
	}

	if (providerAdapter === 'google' && hasCleanSlateNativeReasoningCapability(family, modelId)) {
		const googleLevels = googleThinkingLevelEfforts(modelId);
		if (modelId.includes('2.5')) {
			for (const level of ['none', 'low', 'medium', 'high'] as const) {
				levels.add(level);
			}
			return levels;
		}
		for (const level of CLEANSLATE_REASONING_LEVELS) {
			if (googleLevels.includes(level)) {
				levels.add(level);
			}
		}
		return levels;
	}

	if (providerAdapter === 'anthropic' && family === 'claude' && hasCleanSlateNativeReasoningCapability(family, modelId)) {
		levels.add('high');
		return levels;
	}

	if (providerID === 'grok' && hasCleanSlateNativeReasoningCapability(family, modelId)) {
		levels.add('low');
		levels.add('medium');
		levels.add('high');
		return levels;
	}

	if (family === 'glm') {
		const supportedEfforts = resolveCleanSlateGlmReasoningEfforts(modelId, request.modelReleaseDate);
		for (const level of CLEANSLATE_REASONING_LEVELS) {
			if (supportedEfforts.includes(level)) {
				levels.add(level);
			}
		}
		return levels;
	}

	if (isCleanSlateSarvamModel(modelId)) {
		// Sarvam documents exactly low/medium/high for reasoning_effort.
		return new Set<CleanSlateReasoningLevel>(['low', 'medium', 'high']);
	}

	if (providerAdapter === 'amazon-bedrock' && hasCleanSlateNativeReasoningCapability(family, modelId)) {
		levels.add('low');
		levels.add('high');
		return levels;
	}

	// Catalog-listed efforts (models.dev) are native choices for every remaining
	// family, so the level picker mirrors what the provider actually accepts.
	for (const effort of request.modelsDevMetadata?.reasoningEfforts ?? []) {
		if (isCleanSlateReasoningLevel(effort)) {
			levels.add(effort);
		}
	}

	return levels;
}

function isCleanSlateGpt5Family(modelId: string): boolean {
	return GPT5_FAMILY_RE.test(modelId);
}

function isCleanSlateSarvamModel(modelId: string): boolean {
	return modelId.includes('sarvam');
}

function resolveCleanSlateGlmReasoningEfforts(modelId: string, releaseDate: string | undefined): CleanSlateProviderReasoningEffort[] {
	const version = resolveCleanSlateGlmVersion(modelId);
	if (version) {
		// Z.ai introduced reasoning_effort with GLM-5.2; older majors/minors only expose
		// the thinking on/off switch.
		return version.major > 5 || (version.major === 5 && version.minor >= 2) ? [...GLM_EFFORTS] : [];
	}
	// Bare 'glm' ids: gate on the catalog release date when it is available.
	return releaseDate && releaseDate >= GLM_REASONING_EFFORT_RELEASE_DATE ? [...GLM_EFFORTS] : [];
}

function resolveCleanSlateGlmVersion(modelId: string): { major: number; minor: number } | undefined {
	const match = /(?:^|\/)glm[-.]?(\d+)(?:\.(\d+))?(?:[.\-/]|$)/.exec(modelId);
	if (!match?.[1]) {
		return undefined;
	}
	const rawMajor = Number.parseInt(match[1], 10);
	// Two-digit shorthands such as 'glm52' encode major and minor together.
	if (!match[2] && rawMajor >= 10) {
		return { major: Math.floor(rawMajor / 10), minor: rawMajor % 10 };
	}
	return { major: rawMajor, minor: match[2] ? Number.parseInt(match[2], 10) : 0 };
}

function isCleanSlateGpt5Pro(modelId: string): boolean {
	return GPT5_PRO_RE.test(modelId) || GPT5_VERSIONED_PRO_RE.test(modelId);
}

function resolveCleanSlateGpt5ReasoningEfforts(modelId: string, releaseDate: string | undefined): CleanSlateProviderReasoningEffort[] {
	if (modelId.includes('deep-research')) {
		return ['medium'];
	}
	const chatEfforts = resolveCleanSlateGpt5ChatReasoningEfforts(modelId);
	if (chatEfforts) {
		return [...chatEfforts];
	}
	if (GPT5_VERSIONED_PRO_RE.test(modelId)) {
		return [...OPENAI_GPT5_PRO_2_PLUS_EFFORTS];
	}
	if (isCleanSlateGpt5Pro(modelId)) {
		return [...OPENAI_GPT5_PRO_EFFORTS];
	}
	const codexEfforts = resolveCleanSlateGpt5CodexReasoningEfforts(modelId);
	if (codexEfforts) {
		return [...codexEfforts];
	}
	const versionedEfforts = resolveCleanSlateVersionedGpt5ReasoningEfforts(modelId);
	if (versionedEfforts) {
		return [...versionedEfforts];
	}
	const efforts = [...WIDELY_SUPPORTED_EFFORTS];
	if (isCleanSlateGpt5Family(modelId)) {
		efforts.unshift('minimal');
	}
	if (releaseDate && releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE) {
		efforts.unshift('none');
	}
	if (releaseDate && releaseDate >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) {
		efforts.push('xhigh');
	}
	return efforts;
}

function resolveCleanSlateOpenAICompatibleReasoningEfforts(modelId: string): CleanSlateProviderReasoningEffort[] {
	const chatEfforts = resolveCleanSlateGpt5ChatReasoningEfforts(modelId);
	if (chatEfforts) {
		return [...chatEfforts];
	}
	if (GPT5_VERSIONED_PRO_RE.test(modelId)) {
		return [...OPENAI_GPT5_PRO_2_PLUS_EFFORTS];
	}
	if (isCleanSlateGpt5Pro(modelId)) {
		return [...OPENAI_GPT5_PRO_EFFORTS];
	}
	return [
		...(resolveCleanSlateGpt5CodexReasoningEfforts(modelId)
			?? resolveCleanSlateVersionedGpt5ReasoningEfforts(modelId)
			?? OPENAI_EFFORTS)
	];
}

function resolveCleanSlateGpt5Version(modelId: string): number | undefined {
	return Number(GPT5_VERSION_RE.exec(modelId)?.[1]) || undefined;
}

function shouldUseOpenAIResponsesApiForModel(modelId: string): boolean {
	const version = resolveCleanSlateGpt5Version(modelId);
	return version !== undefined
		&& version >= 4
		&& !modelId.includes('codex')
		&& !modelId.includes('-chat');
}

function shouldUseResponsesApiForProvider(providerID: string, providerAdapter: CleanSlateProviderAdapter, modelId: string): boolean {
	if (!shouldUseOpenAIResponsesApiForModel(modelId)) {
		return false;
	}
	if (providerID === 'openai') {
		return true;
	}
	return (providerID === 'azure-foundry' || providerAdapter === 'azure')
		&& shouldUseAzureOpenAIResponsesApiForModel(modelId);
}

function shouldUseAzureOpenAIResponsesApiForModel(modelId: string): boolean {
	const version = resolveCleanSlateGpt5Version(modelId);
	// Align with direct OpenAI (gpt-5.4+): Azure's v1 endpoint serves the Responses
	// API for these models, and it is required for streamed reasoning summaries.
	return isCleanSlateGpt5Pro(modelId) || (version !== undefined && version >= 4);
}

function shouldUseOpenAIPriorityProcessing(providerID: string, modelId: string): boolean {
	if (providerID !== 'openai' || isCleanSlateGpt5Pro(modelId) || modelId.includes('codex') || modelId.includes('-chat') || modelId.includes('nano')) {
		return false;
	}
	if (modelId === 'gpt-5' || modelId.startsWith('gpt-5-mini')) {
		return true;
	}
	const version = resolveCleanSlateGpt5Version(modelId);
	return version === 1 || version === 2 || version === 4 || version === 5 || version === 6;
}

function resolveCleanSlateVersionedGpt5ReasoningEfforts(modelId: string): readonly CleanSlateProviderReasoningEffort[] | undefined {
	if (GPT5_VERSIONED_PRO_RE.test(modelId)) {
		return OPENAI_GPT5_PRO_2_PLUS_EFFORTS;
	}
	const version = resolveCleanSlateGpt5Version(modelId);
	if (version === undefined) {
		return undefined;
	}
	if (version === 1) {
		return OPENAI_GPT5_1_EFFORTS;
	}
	if (version >= 6) {
		return OPENAI_GPT5_6_PLUS_EFFORTS;
	}
	return OPENAI_GPT5_2_PLUS_EFFORTS;
}

function resolveCleanSlateGpt5CodexReasoningEfforts(modelId: string): readonly CleanSlateProviderReasoningEffort[] | undefined {
	if (!isCleanSlateGpt5Family(modelId) || !modelId.includes('codex')) {
		return undefined;
	}
	const version = resolveCleanSlateGpt5Version(modelId);
	if (version !== undefined && version >= 3) {
		return OPENAI_GPT5_CODEX_3_PLUS_EFFORTS;
	}
	if (modelId.includes('codex-max') || (version !== undefined && version >= 2)) {
		return OPENAI_GPT5_CODEX_XHIGH_EFFORTS;
	}
	return WIDELY_SUPPORTED_EFFORTS;
}

function resolveCleanSlateGpt5ChatReasoningEfforts(modelId: string): readonly CleanSlateProviderReasoningEffort[] | undefined {
	if (!isCleanSlateGpt5Family(modelId) || !modelId.includes('-chat')) {
		return undefined;
	}
	return resolveCleanSlateGpt5Version(modelId) === undefined ? [] : OPENAI_GPT5_CHAT_EFFORTS;
}

function resolveCleanSlateBedrockReasoningConfig(
	request: ICleanSlateModelCapabilityRequest,
	modelId: string,
	family: CleanSlateModelFamily,
	outputLimit: number
): Record<string, any> | undefined {
	if (!hasCleanSlateNativeReasoningCapability(family, modelId)) {
		return undefined;
	}
	const reasoningLevel = getRequestReasoningLevel(request);
	const effort = reasoningLevel === 'high' ? 'high' : reasoningLevel === 'low' ? 'low' : undefined;
	if (!effort) {
		return undefined;
	}
	if (modelId.includes('anthropic')) {
		return {
			reasoningConfig: {
				type: 'enabled',
				budgetTokens: Math.min(effort === 'high' ? 16_000 : 4_000, outputLimit - 1)
			}
		};
	}
	return {
		reasoningConfig: {
			type: 'enabled',
			maxReasoningEffort: effort
		}
	};
}

function resolveCleanSlateAnthropicThinkingConfig(modelId: string, outputLimit: number): Record<string, any> {
	if (modelId.includes('claude-fable-5') || ['opus-4-7', 'opus-4.7', 'opus-4-6', 'opus-4.6', 'sonnet-4-6', 'sonnet-4.6'].some(value => modelId.includes(value))) {
		return { type: 'adaptive' };
	}
	if (['opus-4-5', 'opus-4.5'].some(value => modelId.includes(value))) {
		return { type: 'enabled', budgetTokens: Math.min(16_000, Math.floor(outputLimit / 2 - 1)) };
	}
	return {
		type: 'enabled',
		budgetTokens: Math.min(16_000, Math.floor(outputLimit / 2 - 1))
	};
}

function resolveCleanSlateGeminiThinkingConfig(
	request: ICleanSlateModelCapabilityRequest,
	family: CleanSlateModelFamily,
	modelId: string
): Record<string, any> | undefined {
	if (!hasCleanSlateNativeReasoningCapability(family, modelId)) {
		return undefined;
	}

	const reasoningLevel = getRequestReasoningLevel(request);
	if (reasoningLevel === 'none') {
		return undefined;
	}
	if (reasoningLevel === 'minimal' || reasoningLevel === 'low') {
		return {
			includeThoughts: true,
			...googleSmallThinkingConfig(modelId)
		};
	}

	if (reasoningLevel === 'high') {
		if (modelId.includes('2.5')) {
			return {
				includeThoughts: true,
				thinkingBudget: 16_000
			};
		}
		return {
			includeThoughts: true,
			thinkingLevel: googleThinkingLevelEfforts(modelId).includes('high') ? 'high' : 'low'
		};
	}

	const config: Record<string, any> = { includeThoughts: true };
	if (modelId.includes('gemini-3')) {
		config.thinkingLevel = 'high';
	}
	return config;
}

function googleThinkingLevelEfforts(modelId: string): string[] {
	if (!modelId.includes('gemini-3')) {
		return ['low', 'high'];
	}
	if (modelId.includes('flash-image')) {
		return ['minimal', 'high'];
	}
	if (modelId.includes('pro-image')) {
		return ['high'];
	}
	if (modelId.includes('flash')) {
		return ['minimal', 'low', 'medium', 'high'];
	}
	return ['low', 'medium', 'high'];
}

function googleThinkingBudgetMax(modelId: string): number {
	return modelId.includes('2.5') && modelId.includes('pro') && !modelId.includes('flash')
		? 32_768
		: 24_576;
}

function googleSmallThinkingConfig(modelId: string): Record<string, any> {
	const levels = googleThinkingLevelEfforts(modelId);
	if (modelId.includes('gemini-3')) {
		return {
			thinkingLevel: levels.includes('minimal') ? 'minimal' : levels.includes('low') ? 'low' : 'high'
		};
	}
	return {
		thinkingBudget: googleThinkingBudgetMax(modelId) === 32_768 ? 128 : 0
	};
}

function hasCleanSlateNativeReasoningCapability(family: CleanSlateModelFamily, modelId: string): boolean {
	if (family === 'openai-reasoning' || family === 'deepseek' || family === 'qwen' || family === 'glm' || family === 'minimax') {
		return true;
	}
	if (family === 'grok') {
		return modelId.includes('grok-3-mini') || modelId.includes('grok-4');
	}
	if (family === 'gemini') {
		return modelId.includes('2.5') || modelId.includes('gemini-3');
	}
	if (family === 'claude') {
		return /claude-(?:3[.-]7|4|opus-4|sonnet-4|haiku-4|fable-5)/.test(modelId);
	}
	if (family === 'bedrock') {
		return modelId.includes('anthropic') || modelId.includes('nova');
	}
	if (family === 'kimi') {
		return modelId.includes('thinking') || modelId.includes('k2p') || modelId.includes('kimi-k2.');
	}
	return false;
}

function resolveReasoningEffort(reasoningLevel: CleanSlateReasoningLevel, azureOpenAIModelEndpoint: boolean): CleanSlateProviderReasoningEffort | undefined {
	void azureOpenAIModelEndpoint;
	if (reasoningLevel === 'none') {
		return undefined;
	}
	return reasoningLevel;
}

function supportsNativeToolCalls(provider: AIProvider, family: CleanSlateModelFamily): boolean {
	if (family === 'unknown') {
		return false;
	}
	return provider === 'openai'
		|| provider === 'azureOpenAI'
		|| provider === 'anthropic'
		|| provider === 'gemini'
		|| provider === 'grok'
		|| provider === 'nvidia'
		|| provider === 'openrouter'
		|| provider === 'custom'
		|| provider === 'bedrock';
}

function normalizePositiveInteger(value: number | undefined, minimum: number): number | undefined {
	return Number.isFinite(value) && value! > 0
		? Math.max(minimum, Math.floor(value!))
		: undefined;
}

function normalizeContextLimits(limits: ICleanSlateContextLimits | undefined, modelOutputTokenLimit: number): {
	modelContextWindowTokens: number;
	maxInputTokens: number;
	effectiveContextWindowTokens: number;
	autoCompactReserveTokens: number;
} {
	const resolvedLimits = limits ?? fallbackContextLimit();
	const modelContextWindowTokens = normalizePositiveInteger(resolvedLimits.modelContextWindowTokens, MIN_CONTEXT_WINDOW_TOKENS) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
	const maxInputTokens = normalizePositiveInteger(resolvedLimits.maxInputTokens, MIN_CONTEXT_WINDOW_TOKENS) ?? modelContextWindowTokens;
	const explicitEffectiveContextWindowTokens = normalizePositiveInteger(resolvedLimits.effectiveContextWindowTokens, MIN_CONTEXT_WINDOW_TOKENS);
	const outputReserveTokens = resolveOutputReserveTokens(modelOutputTokenLimit);
	const autoCompactReserveTokens = explicitEffectiveContextWindowTokens !== undefined
		? Math.max(0, maxInputTokens - explicitEffectiveContextWindowTokens)
		: resolvedLimits.maxInputTokens !== undefined
			? resolveInputReserveTokens(modelOutputTokenLimit)
			: outputReserveTokens;
	const effectiveContextWindowTokens = explicitEffectiveContextWindowTokens
		?? Math.max(MIN_CONTEXT_WINDOW_TOKENS, maxInputTokens - autoCompactReserveTokens);

	return {
		modelContextWindowTokens,
		maxInputTokens,
		effectiveContextWindowTokens,
		autoCompactReserveTokens
	};
}

function resolveOutputReserveTokens(modelOutputTokenLimit: number): number {
	const normalizedLimit = normalizePositiveInteger(modelOutputTokenLimit, MIN_CONTEXT_WINDOW_TOKENS) ?? DEFAULT_REQUEST_OUTPUT_CAP_TOKENS;
	return Math.min(normalizedLimit, DEFAULT_REQUEST_OUTPUT_CAP_TOKENS);
}

function resolveInputReserveTokens(modelOutputTokenLimit: number): number {
	return Math.min(DEFAULT_KNOWN_INPUT_BUFFER_TOKENS, resolveOutputReserveTokens(modelOutputTokenLimit));
}

function inferModelLimitProfile(family: CleanSlateModelFamily, model: string | undefined, metadata?: ICleanSlateModelsDevModelMetadata): ICleanSlateModelLimitProfile {
	const catalogLimits = toModelsDevLimitProfile(metadata);
	if (catalogLimits) {
		return catalogLimits;
	}
	const normalizedModel = normalizeModelId(model);
	switch (family) {
		case 'grok':
			if (normalizedModel.includes('grok-4.20')) {
				return MODEL_LIMITS.grok.grok420;
			}
			if (normalizedModel.includes('grok-4.3') || normalizedModel.includes('grok-4')) {
				return MODEL_LIMITS.grok.grok4;
			}
			return MODEL_LIMITS.grok.default;
		case 'kimi':
			if (normalizedModel.includes('8k')) {
				return MODEL_LIMITS.kimi.k8;
			}
			if (normalizedModel.includes('32k')) {
				return MODEL_LIMITS.kimi.k32;
			}
			if (normalizedModel.includes('128k')) {
				return MODEL_LIMITS.kimi.k128;
			}
			if (normalizedModel.includes('kimi-k2.5') || normalizedModel.includes('kimi-k2p5') || normalizedModel.includes('kimi-k2-5')) {
				return MODEL_LIMITS.kimi.k25;
			}
			return MODEL_LIMITS.kimi.default;
		case 'deepseek':
			if (normalizedModel.includes('v4')) {
				return MODEL_LIMITS.deepseek.v4;
			}
			return MODEL_LIMITS.deepseek.default;
		case 'qwen':
			if (normalizedModel.includes('qwen3.5-plus')) {
				return MODEL_LIMITS.qwen.plus;
			}
			if (normalizedModel.includes('qwen3-max')) {
				return MODEL_LIMITS.qwen.max;
			}
			if (normalizedModel.includes('qwen3-coder')) {
				return MODEL_LIMITS.qwen.coder;
			}
			return MODEL_LIMITS.qwen.default;
		case 'glm':
			return MODEL_LIMITS.glm.default;
		case 'minimax':
			if (normalizedModel.includes('m2')) {
				return MODEL_LIMITS.minimax.m2;
			}
			return MODEL_LIMITS.minimax.default;
		case 'mistral':
			if (normalizedModel.includes('mixtral-8x7b')) {
				return MODEL_LIMITS.mistral.mixtral8x7b;
			}
			if (normalizedModel.includes('mixtral-8x22b')) {
				return MODEL_LIMITS.mistral.mixtral8x22b;
			}
			return MODEL_LIMITS.mistral.default;
		case 'llama':
			return MODEL_LIMITS.llama.default;
		case 'cohere':
			if (normalizedModel.includes('command-a')) {
				return MODEL_LIMITS.cohere.commandA;
			}
			return MODEL_LIMITS.cohere.default;
		case 'nemotron':
			if (normalizedModel.includes('nemotron-3-ultra-550b-a55b')) {
				return MODEL_LIMITS.nemotron.ultra550b;
			}
			return MODEL_LIMITS.nemotron.default;
		case 'openai-reasoning':
			return inferOpenAIContextLimits(normalizedModel);
		case 'openai-compatible-chat':
			if (normalizedModel.includes('sarvam')) {
				return { modelContextWindowTokens: 128_000, modelMaxOutputTokens: 16_384 };
			}
			return { modelContextWindowTokens: 128_000, modelMaxOutputTokens: DEFAULT_MODEL_OUTPUT_TOKENS };
		case 'openai-chat':
			if (normalizedModel.includes('gpt-4.1')) {
				return MODEL_LIMITS.openai.gpt41;
			}
			return MODEL_LIMITS.openai.defaultChat;
		case 'gemini':
			if (normalizedModel.includes('gemini-2.5') || normalizedModel.includes('gemini-3')) {
				return MODEL_LIMITS.gemini.long;
			}
			if (normalizedModel.includes('gemini-1.5-pro')) {
				return MODEL_LIMITS.gemini.pro15;
			}
			return MODEL_LIMITS.gemini.default;
		case 'claude':
			if (normalizedModel.includes('claude-fable-5')) {
				return { modelContextWindowTokens: 1_000_000, modelMaxOutputTokens: 128_000 };
			}
			if (normalizedModel.includes('4.6') || normalizedModel.includes('4.7') || normalizedModel.includes('mythos')) {
				return MODEL_LIMITS.claude.long;
			}
			return MODEL_LIMITS.claude.default;
		case 'bedrock':
			if (normalizedModel.includes('anthropic') || normalizedModel.includes('claude')) {
				return inferModelLimitProfile('claude', normalizedModel);
			}
			return { ...fallbackContextLimit(), modelMaxOutputTokens: 32_000 };
		default:
			return fallbackContextLimit();
	}
}

function toModelsDevLimitProfile(metadata: ICleanSlateModelsDevModelMetadata | undefined): ICleanSlateModelLimitProfile | undefined {
	if (!metadata || !Number.isSafeInteger(metadata.contextWindowTokens) || metadata.contextWindowTokens! < MIN_CONTEXT_WINDOW_TOKENS) {
		return undefined;
	}
	return {
		modelContextWindowTokens: metadata.contextWindowTokens!,
		maxInputTokens: Number.isSafeInteger(metadata.maxInputTokens) && metadata.maxInputTokens! > 0 ? metadata.maxInputTokens : undefined,
		modelMaxOutputTokens: Number.isSafeInteger(metadata.maxOutputTokens) && metadata.maxOutputTokens! > 0 ? metadata.maxOutputTokens : undefined
	};
}

function inferOpenAIContextLimits(normalizedModel: string): ICleanSlateContextLimits {
	if (normalizedModel.includes('codex')) {
		return MODEL_LIMITS.openai.gpt5;
	}
	const version = resolveGpt5Version(normalizedModel);
	if (version !== undefined && version >= 4 && !normalizedModel.includes('mini')) {
		return MODEL_LIMITS.openai.gpt5Long;
	}
	if (normalizedModel.includes('gpt-5') || version !== undefined) {
		return MODEL_LIMITS.openai.gpt5;
	}
	return MODEL_LIMITS.openai.defaultChat;
}

function resolveGpt5Version(normalizedModel: string): number | undefined {
	const gpt5Match = normalizedModel.match(GPT5_VERSION_RE);
	if (gpt5Match?.[1]) {
		return Number.parseInt(gpt5Match[1], 10);
	}
	const bareMatch = normalizedModel.match(/(?:^|[^0-9])5\.(\d+)(?:[^0-9]|$)/);
	if (bareMatch?.[1]) {
		return Number.parseInt(bareMatch[1], 10);
	}
	return undefined;
}

function fallbackContextLimit(): ICleanSlateContextLimits {
	return {
		modelContextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
		maxInputTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
		effectiveContextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS
	};
}

function inferOutputTokenLimit(family: CleanSlateModelFamily, model: string | undefined): number {
	return inferModelLimitProfile(family, model).modelMaxOutputTokens ?? DEFAULT_MODEL_OUTPUT_TOKENS;
}
