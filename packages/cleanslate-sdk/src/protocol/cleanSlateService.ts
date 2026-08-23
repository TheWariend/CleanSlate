/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateService, IChatMessage, IChatOptions, ICleanSlateConfigurationService, AIProvider, ICleanSlateMainService, ICleanSlateLogger, CleanSlateResponsePart, ICleanSlateProviderCapabilities, ICleanSlateConfiguration, CleanSlateReasoningLevel, isCleanSlateReasoningLevel } from './cleanSlateAI.js';
import { VSBuffer } from '../core/buffer.js';
import { CancellationToken } from '../core/cancellation.js';
import { Subscribable } from '../host/events.js';
import { CleanSlateOpenAICompatibleProviderFlavor, CleanSlateProviderReasoningEffort, ICleanSlateModelCapabilityRequest, resolveCleanSlateModelCapabilities, resolveCleanSlateModelFamily } from './cleanSlateModelCapabilities.js';
import { normalizeCleanSlateMessagesForProvider } from './cleanSlateProviderMessageTransforms.js';

const CLEANSLATE_NVIDIA_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const CLEANSLATE_OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

interface IOpenAICompatibleRequestProfile {
	reasoningLevel: CleanSlateReasoningLevel;
	maxOutputTokens?: number;
	useMaxCompletionTokens: boolean;
	useResponsesApi?: boolean;
	includeSamplingParameters: boolean;
	temperature?: number;
	topP?: number;
	topK?: number;
	reasoningEffort?: CleanSlateProviderReasoningEffort;
	reasoningSummary?: 'auto';
	parallelToolCalls?: boolean;
	store?: boolean;
	promptCacheKey?: string;
	include?: string[];
	bodyOptions?: Record<string, any>;
	suppressReasoningContent?: boolean;
}

interface IProviderRequestDiagnostics extends IOpenAICompatibleRequestProfile {
	providerName: string;
	model: string;
	messageCount: number;
	toolCount: number;
	inputChars: number;
	estimatedInputTokens: number;
	transport?: 'openai-compatible' | 'openai-responses' | 'azure-openai';
	baseUrl?: string;
	endpoint?: string;
	nativeReasoningPayload?: string;
}

export class CleanSlateService implements ICleanSlateService {

	_serviceBrand: undefined;
	private readonly modelsDevMetadata = new Map<string, Awaited<ReturnType<ICleanSlateMainService['getModelsDevModelMetadata']>>>();

	constructor(
		private readonly configService: ICleanSlateConfigurationService,
		private readonly cleanSlateMainService: ICleanSlateMainService,
		private readonly logger: ICleanSlateLogger
	) { }

	async generate(prompt: string): Promise<AsyncIterable<CleanSlateResponsePart>> {
		return this.chat([{ role: 'user', content: prompt }]);
	}

	async getModels(provider?: AIProvider): Promise<string[]> {
		const config = await this.configService.getResolvedConfiguration();
		const currentProvider = provider || config.provider;
		await this.ensureModelsDevMetadata(currentProvider, this.getConfiguredModelForProvider(config, currentProvider));
		switch (currentProvider) {
			case 'cleanslate':
				return this.getCleanSlateManagedModels(config);
			case 'openai':
				return this.getOpenAIModels(config);
			case 'azureOpenAI':
				return config.providers?.azureOpenAI?.deploymentName ? [config.providers.azureOpenAI.deploymentName] : [];
			case 'grok':
				return this.getGrokModels(config);
			case 'nvidia':
				return this.getNvidiaModels(config);
			case 'openrouter':
				return this.getOpenRouterModels(config);
			case 'custom':
				return this.getCustomModels(config);
			case 'anthropic':
				return this.getAnthropicModels(config);
			case 'gemini':
				return this.getGeminiModels(config);
			case 'bedrock':
				return this.getBedrockModels(config);
			default:
				return [];
		}
	}

	private async getCleanSlateManagedModels(config: ICleanSlateConfiguration): Promise<string[]> {
		if (!config.providers?.cleanslate?.apiKey) {
			return [];
		}
		const entitlements = await this.configService.getManagedEntitlements();
		// The plan's models are listed regardless of current usage. Being over
		// quota blocks sending (surfaced as the quota card), it must NOT empty
		// the model picker — that reads as "misconfigured" instead of "limit
		// reached". Only a genuine lack of plan/models yields an empty list.
		const managedModels = (entitlements.models || []).filter(model => !!model.id?.trim());
		for (const model of managedModels) {
			const id = model.id.trim();
			// The backend is authoritative for managed model limits (e.g. DeepSeek
			// V4 Flash's 1M-token window). Seed the metadata cache so capability
			// resolution prefers these over client-side family defaults.
			const seeded: NonNullable<Awaited<ReturnType<ICleanSlateMainService['getModelsDevModelMetadata']>>> = {
				id,
				provider: 'cleanslate',
				contextWindowTokens: this.toPositiveInteger(model.context_window_tokens),
				maxOutputTokens: this.toPositiveInteger(model.max_output_tokens)
			};
			if (isCleanSlateReasoningLevel(model.reasoning_effort)) {
				seeded.reasoningEfforts = [model.reasoning_effort];
			}
			this.modelsDevMetadata.set(this.modelsDevMetadataKey('cleanslate', id), seeded);
		}
		const models = managedModels.map(model => model.id.trim());
		return this.withConfiguredModel(config.providers.cleanslate.model, models);
	}

	private async getOpenAIModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.openai;
		if (!provider?.apiKey) {
			return [];
		}
		const models = await this.cleanSlateMainService.listOpenAICompatibleModels({
			apiKey: provider.apiKey,
			baseUrl: provider.baseUrl || 'https://api.openai.com/v1'
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.model, models);
	}

	private async getGrokModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.grok;
		if (!provider?.apiKey) {
			return [];
		}
		const models = await this.cleanSlateMainService.listOpenAICompatibleModels({
			apiKey: provider.apiKey,
			baseUrl: provider.baseUrl || 'https://api.x.ai/v1'
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.model, models);
	}

	private async getNvidiaModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.nvidia;
		if (!provider?.apiKey) {
			return [];
		}
		const models = await this.cleanSlateMainService.listOpenAICompatibleModels({
			apiKey: provider.apiKey,
			baseUrl: provider.baseUrl || CLEANSLATE_NVIDIA_DEFAULT_BASE_URL,
			providerName: 'NVIDIA NIM'
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.model, models);
	}

	private async getOpenRouterModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.openrouter;
		if (!provider?.apiKey) {
			return this.withConfiguredModel(provider?.model, []);
		}
		const models = await this.cleanSlateMainService.listOpenAICompatibleModels({
			apiKey: provider.apiKey,
			baseUrl: provider.baseUrl || CLEANSLATE_OPENROUTER_DEFAULT_BASE_URL,
			providerName: 'OpenRouter'
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.model, models);
	}

	private async getCustomModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.custom;
		if (!provider?.baseUrl) {
			return this.withConfiguredModel(provider?.model, []);
		}
		const models = await this.cleanSlateMainService.listOpenAICompatibleModels({
			apiKey: provider.apiKey,
			baseUrl: provider.baseUrl,
			providerName: 'Custom API'
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.model, models);
	}

	private async getAnthropicModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.anthropic;
		if (!provider?.apiKey) {
			return [];
		}
		const models = await this.cleanSlateMainService.listAnthropicModels({
			apiKey: provider.apiKey,
			baseUrl: provider.baseUrl || 'https://api.anthropic.com/v1'
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.model, models);
	}

	private async getGeminiModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.gemini;
		if (!provider?.apiKey) {
			return [];
		}
		const models = await this.cleanSlateMainService.listGeminiModels({
			apiKey: provider.apiKey
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.model, models);
	}

	private async getBedrockModels(config: ICleanSlateConfiguration): Promise<string[]> {
		const provider = config.providers?.bedrock;
		if (!provider?.region) {
			return [];
		}
		const models = await this.cleanSlateMainService.listBedrockFoundationModels({
			region: provider.region,
			credentialMode: provider.credentialMode || 'default',
			profile: provider.profile,
			accessKeyId: provider.accessKeyId,
			secretAccessKey: provider.secretAccessKey,
			sessionToken: provider.sessionToken
		}, CancellationToken.None);
		return this.withConfiguredModel(provider.modelId, models);
	}

	private withConfiguredModel(configuredModel: string | undefined, models: string[]): string[] {
		if (configuredModel && !models.includes(configuredModel)) {
			return [configuredModel, ...models];
		}
		return models;
	}

	private trimTrailingSlash(value: string): string {
		return value.replace(/\/+$/, '');
	}

	private isAzureOpenAIV1Endpoint(endpoint: string): boolean {
		try {
			const url = new URL(endpoint);
			const hostname = url.hostname.toLowerCase();
			return url.pathname.toLowerCase().includes('/openai/v1')
				|| hostname.endsWith('.services.ai.azure.com')
				|| hostname.endsWith('.openai.azure.com');
		} catch {
			const normalized = endpoint.toLowerCase();
			return normalized.includes('/openai/v1')
				|| normalized.includes('.services.ai.azure.com')
				|| normalized.includes('.openai.azure.com');
		}
	}

	private shouldUseAzureOpenAIV1ChatCompletions(endpoint: string, deploymentName: string): boolean {
		if (this.isAzureOpenAIV1Endpoint(endpoint)) {
			return true;
		}

		const family = resolveCleanSlateModelFamily('azureOpenAI', deploymentName);
		return family === 'grok'
			|| family === 'kimi'
			|| family === 'deepseek'
			|| family === 'qwen'
			|| family === 'mistral'
			|| family === 'llama'
			|| family === 'cohere';
	}

	private toAzureOpenAIV1BaseUrl(endpoint: string): string {
		try {
			const url = new URL(endpoint);
			const lowerPath = url.pathname.toLowerCase();
			const marker = '/openai/v1';
			const markerIndex = lowerPath.indexOf(marker);
			url.pathname = markerIndex >= 0
				? `${url.pathname.slice(0, markerIndex + marker.length).replace(/\/+$/, '')}/`
				: '/openai/v1/';
			url.search = '';
			url.hash = '';
			return url.toString();
		} catch {
			const trimmed = this.trimTrailingSlash(endpoint.trim());
			return trimmed.toLowerCase().includes('/openai/v1')
				? `${trimmed}/`
				: `${trimmed}/openai/v1/`;
		}
	}

	private withOpenAIPriorityContextGuard(requestProfile: IOpenAICompatibleRequestProfile, messages: IChatMessage[]): IOpenAICompatibleRequestProfile {
		if (requestProfile.bodyOptions?.service_tier !== 'priority') {
			return requestProfile;
		}
		const estimatedInputTokens = Math.ceil(this.estimateMessagesTextLength(messages) / 4);
		if (estimatedInputTokens <= 128_000) {
			return requestProfile;
		}
		const bodyOptions = { ...requestProfile.bodyOptions };
		delete bodyOptions.service_tier;
		return {
			...requestProfile,
			bodyOptions: Object.keys(bodyOptions).length ? bodyOptions : undefined
		};
	}

	getProviderCapabilities(provider?: AIProvider): ICleanSlateProviderCapabilities {
		const config = this.configService.getConfiguration();
		const currentProvider = provider || config.provider;
		if (currentProvider === 'cleanslate') {
			return { provider: currentProvider, nativeToolCalls: true };
		}
		const capabilities = this.resolveModelCapabilities({
			provider: currentProvider,
			model: this.getConfiguredModelForProvider(config, currentProvider),
			flavor: this.getOpenAICompatibleFlavorForProvider(config, currentProvider),
			planMode: config.planMode,
			reasoningLevel: config.reasoningLevel,
			configuredMaxOutputTokens: config.maxOutputTokens
		});
		return {
			provider: currentProvider,
			nativeToolCalls: capabilities.nativeToolCalls,
			degradedReason: capabilities.nativeToolCalls
				? undefined
				: `Provider "${currentProvider}" has no declared native tool-call adapter for model "${capabilities.model ?? 'unknown'}".`
		};
	}

	async chat(messages: IChatMessage[], options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const config = await this.configService.getResolvedConfiguration();
		await this.ensureModelsDevMetadata(config.provider, this.getConfiguredModelForProvider(config, config.provider));
		this.assertProviderSupportsRequestedTools(config.provider, options);
		this.logger.info(`[CleanSlateService] provider=${config.provider} model=${config.model ?? 'unknown'} reasoning=${config.reasoningLevel ?? 'low'} planMode=${config.planMode ? 'yes' : 'no'} messages=${messages.length} tools=${options.tools?.length ?? 0}`);
		switch (config.provider) {
			case 'cleanslate':
				return this.chatCleanSlateManaged(messages, config, options);
			case 'azureOpenAI':
				return this.chatAzureOpenAI(messages, config, options);
			case 'grok':
				return this.chatGrok(messages, config, options);
			case 'nvidia':
				return this.chatNvidia(messages, config, options);
			case 'openrouter':
				return this.chatOpenRouter(messages, config, options);
			case 'custom':
				return this.chatCustom(messages, config, options);
			case 'anthropic':
				return this.chatAnthropic(messages, config, options);
			case 'gemini':
				return this.chatGemini(messages, config, options);
			case 'bedrock':
				return this.chatBedrock(messages, config, options);
			case 'openai':
			default:
				return this.chatOpenAI(messages, config, options);
		}
	}

	private assertProviderSupportsRequestedTools(provider: AIProvider, options: IChatOptions): void {
		if (!options.tools?.length && !options.requiredToolName) {
			return;
		}
		const capabilities = this.getProviderCapabilities(provider);
		if (capabilities.nativeToolCalls) {
			return;
		}
		throw new Error(`[CleanSlateService] Provider "${provider}" is degraded for agentic tool execution: ${capabilities.degradedReason ?? 'native tool calls are unavailable'}`);
	}

	private getOpenAICompatibleRequestProfile(config: ICleanSlateConfiguration, model: string | undefined, flavor: CleanSlateOpenAICompatibleProviderFlavor, options?: IChatOptions, capabilityProvider?: AIProvider): IOpenAICompatibleRequestProfile {
		const provider = capabilityProvider ?? (flavor === 'xai'
			? 'grok'
			: flavor === 'nvidia'
				? 'nvidia'
				: flavor === 'openrouter'
					? 'openrouter'
					: flavor === 'custom'
						? 'custom'
						: flavor === 'openai'
							? 'openai'
							: 'azureOpenAI');
		const capabilities = this.resolveModelCapabilities({
			provider,
			model,
			flavor,
			planMode: config.planMode,
			reasoningLevel: config.reasoningLevel,
			configuredMaxOutputTokens: config.maxOutputTokens,
			sessionId: options?.sessionId
		});
		return {
			reasoningLevel: config.reasoningLevel ?? 'low',
			maxOutputTokens: this.capRequestOutputTokens(capabilities.maxOutputTokens, options?.maxOutputTokens),
			useMaxCompletionTokens: capabilities.useMaxCompletionTokens,
			useResponsesApi: capabilities.useResponsesApi,
			includeSamplingParameters: capabilities.includeSamplingParameters,
			temperature: capabilities.temperature,
			topP: capabilities.topP,
			topK: capabilities.topK,
			reasoningEffort: capabilities.reasoningEffort,
			reasoningSummary: capabilities.reasoningSummary,
			parallelToolCalls: capabilities.parallelToolCalls,
			store: capabilities.store,
			promptCacheKey: capabilities.promptCacheKey,
			include: capabilities.include,
			bodyOptions: capabilities.bodyOptions,
			suppressReasoningContent: capabilities.suppressReasoningContent
		};
	}

	private getConfiguredModelForProvider(config: ICleanSlateConfiguration, provider: AIProvider): string | undefined {
		switch (provider) {
			case 'cleanslate':
				return config.providers?.cleanslate?.model || 'gpt-5.4';
			case 'openai':
				return config.providers?.openai?.model || config.model;
			case 'azureOpenAI':
				return config.providers?.azureOpenAI?.deploymentName || config.model;
			case 'grok':
				return config.providers?.grok?.model || config.model;
			case 'nvidia':
				return config.providers?.nvidia?.model || config.model;
			case 'openrouter':
				return config.providers?.openrouter?.model || config.model;
			case 'custom':
				return config.providers?.custom?.model || config.model;
			case 'anthropic':
				return config.providers?.anthropic?.model || config.model;
			case 'gemini':
				return config.providers?.gemini?.model || config.model;
			case 'bedrock':
				return config.providers?.bedrock?.modelId || config.model;
			default:
				return config.model;
		}
	}

	private async ensureModelsDevMetadata(provider: AIProvider, model: string | undefined): Promise<void> {
		const normalizedModel = model?.trim();
		if (!normalizedModel || typeof this.cleanSlateMainService.getModelsDevModelMetadata !== 'function') {
			return;
		}
		const key = this.modelsDevMetadataKey(provider, normalizedModel);
		if (this.modelsDevMetadata.has(key)) {
			return;
		}
		const metadata = await this.cleanSlateMainService.getModelsDevModelMetadata(provider, normalizedModel, CancellationToken.None);
		this.modelsDevMetadata.set(key, metadata);
	}

	private resolveModelCapabilities(request: ICleanSlateModelCapabilityRequest) {
		const model = request.model?.trim();
		return resolveCleanSlateModelCapabilities({
			...request,
			modelsDevMetadata: model ? this.modelsDevMetadata.get(this.modelsDevMetadataKey(request.provider, model)) : undefined
		});
	}

	private modelsDevMetadataKey(provider: AIProvider, model: string): string {
		return `${provider}:${model}`;
	}

	private toPositiveInteger(value: number | null | undefined): number | undefined {
		return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
	}

	private getOpenAICompatibleFlavorForProvider(config: ICleanSlateConfiguration, provider: AIProvider): CleanSlateOpenAICompatibleProviderFlavor | undefined {
		switch (provider) {
			case 'cleanslate':
				return 'custom';
			case 'openai':
				return 'openai';
			case 'grok':
				return 'xai';
			case 'nvidia':
				return 'nvidia';
			case 'openrouter':
				return 'openrouter';
			case 'custom':
				return 'custom';
			case 'azureOpenAI':
				return this.isAzureOpenAIV1Endpoint(config.providers?.azureOpenAI?.endpoint || '') ? 'azureFoundry' : 'azureOpenAI';
			default:
				return undefined;
		}
	}

	private getProviderRequestProfile(config: ICleanSlateConfiguration, provider: AIProvider, model: string, flavor?: CleanSlateOpenAICompatibleProviderFlavor, options?: IChatOptions): IOpenAICompatibleRequestProfile {
		const capabilities = this.resolveModelCapabilities({
			provider,
			model,
			flavor,
			planMode: config.planMode,
			reasoningLevel: config.reasoningLevel,
			configuredMaxOutputTokens: config.maxOutputTokens,
			sessionId: options?.sessionId
		});
		return {
			reasoningLevel: config.reasoningLevel ?? 'low',
			maxOutputTokens: this.capRequestOutputTokens(capabilities.maxOutputTokens, options?.maxOutputTokens),
			useMaxCompletionTokens: capabilities.useMaxCompletionTokens,
			useResponsesApi: capabilities.useResponsesApi,
			includeSamplingParameters: capabilities.includeSamplingParameters,
			temperature: capabilities.temperature,
			topP: capabilities.topP,
			topK: capabilities.topK,
			reasoningEffort: capabilities.reasoningEffort,
			reasoningSummary: capabilities.reasoningSummary,
			parallelToolCalls: capabilities.parallelToolCalls,
			store: capabilities.store,
			promptCacheKey: capabilities.promptCacheKey,
			include: capabilities.include,
			bodyOptions: capabilities.bodyOptions
		};
	}

	private getProviderChatOptions(options: IChatOptions): IChatOptions {
		const { cancellationToken: _cancellationToken, maxOutputTokens: _maxOutputTokens, ...providerOptions } = options;
		return providerOptions;
	}

	private capRequestOutputTokens(providerCap: number, requestedCap: number | undefined): number {
		const cap = this.toPositiveInteger(requestedCap);
		return cap === undefined ? providerCap : Math.min(providerCap, cap);
	}

	private getChatCancellationToken(options: IChatOptions): CancellationToken {
		return options.cancellationToken ?? CancellationToken.None;
	}

	private async chatCleanSlateManaged(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.cleanslate;
		let token = provider?.apiKey;
		const model = provider?.model || 'gpt-5.4';
		if (!token) {
			throw new Error('Sign in to CleanSlate to use CleanSlate Pro.');
		}

		const createRequest = () => {
			const requestProfile = this.getOpenAICompatibleRequestProfile(config, model, 'custom', options, 'cleanslate');
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'openaiCompatible', model, provider: 'custom', hasTools: !!options.tools?.length });
			const event = this.cleanSlateMainService.openAICompatibleChatStream({
				providerName: 'CleanSlate Pro',
				apiKey: token,
				baseUrl: provider?.baseUrl,
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				...requestProfile
			}, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('CleanSlate Pro', model, requestProfile, providerMessages, options, {
				transport: 'openai-compatible',
				baseUrl: provider?.baseUrl
			}));
		};

		return this.retryOnRateLimit(async () => this.refreshManagedStreamOnUnauthorized(createRequest, async () => {
			token = await this.configService.refreshManagedToken(token);
		}));
	}

	private async *refreshManagedStreamOnUnauthorized(
		createRequest: () => AsyncIterable<CleanSlateResponsePart>,
		refresh: () => Promise<void>
	): AsyncIterable<CleanSlateResponsePart> {
		let refreshed = false;
		while (true) {
			try {
				for await (const part of createRequest()) {
					yield part;
				}
				return;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (refreshed || !/(?:^|\D)401(?:\D|$)|unauthenticated|token_expired/i.test(message)) {
					throw error;
				}
				refreshed = true;
				await refresh();
			}
		}
	}

	private async chatOpenAI(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.openai;
		const apiKey = provider?.apiKey;
		const model = provider?.model || config.model;
		if (!apiKey) {
			throw new Error('OpenAI API key is missing. Add it in CleanSlate Settings.');
		}
		if (!model) {
			throw new Error('OpenAI model is missing. Choose a model in CleanSlate Settings.');
		}

		return this.retryOnRateLimit(async () => {
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'openaiCompatible', model, provider: 'openai', hasTools: !!options.tools?.length });
			const requestProfile = this.withOpenAIPriorityContextGuard(
				this.getOpenAICompatibleRequestProfile(config, model, 'openai', options),
				providerMessages
			);
			const streamOptions = {
				providerName: 'OpenAI',
				apiKey,
				baseUrl: provider.baseUrl || 'https://api.openai.com/v1',
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				...requestProfile
			};
			const event = requestProfile.useResponsesApi
				? this.cleanSlateMainService.openAIResponsesStream(streamOptions, this.getChatCancellationToken(options))
				: this.cleanSlateMainService.openAICompatibleChatStream(streamOptions, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('OpenAI', model, requestProfile, providerMessages, options, {
				transport: requestProfile.useResponsesApi ? 'openai-responses' : 'openai-compatible',
				baseUrl: provider.baseUrl || 'https://api.openai.com/v1'
			}));
		});
	}

	private async chatGrok(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.grok;
		const apiKey = provider?.apiKey;
		const model = provider?.model || config.model;
		if (!apiKey) {
			throw new Error('xAI Grok API key is missing. Add it in CleanSlate Settings.');
		}
		if (!model) {
			throw new Error('Grok model is missing. Choose a model in CleanSlate Settings.');
		}

		return this.retryOnRateLimit(async () => {
			const requestProfile = this.getOpenAICompatibleRequestProfile(config, model, 'xai', options);
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'openaiCompatible', model, provider: 'grok', hasTools: !!options.tools?.length });
			const event = this.cleanSlateMainService.openAICompatibleChatStream({
				providerName: 'xAI Grok',
				apiKey,
				baseUrl: provider.baseUrl || 'https://api.x.ai/v1',
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				...requestProfile
			}, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('xAI Grok', model, requestProfile, providerMessages, options, {
				transport: 'openai-compatible',
				baseUrl: provider.baseUrl || 'https://api.x.ai/v1'
			}));
		});
	}

	private async chatNvidia(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.nvidia;
		const apiKey = provider?.apiKey;
		const model = provider?.model || config.model;
		if (!apiKey) {
			throw new Error('NVIDIA NIM API key is missing. Add it in CleanSlate Settings.');
		}
		if (!model) {
			throw new Error('NVIDIA model is missing. Choose a model in CleanSlate Settings.');
		}

		return this.retryOnRateLimit(async () => {
			const requestProfile = this.getOpenAICompatibleRequestProfile(config, model, 'nvidia', options);
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'openaiCompatible', model, provider: 'nvidia', hasTools: !!options.tools?.length });
			const event = this.cleanSlateMainService.openAICompatibleChatStream({
				providerName: 'NVIDIA NIM',
				apiKey,
				baseUrl: provider.baseUrl,
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				...requestProfile
			}, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('NVIDIA NIM', model, requestProfile, providerMessages, options, {
				transport: 'openai-compatible',
				baseUrl: provider.baseUrl
			}));
		});
	}

	private async chatOpenRouter(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.openrouter;
		const apiKey = provider?.apiKey;
		const model = provider?.model || config.model;
		if (!apiKey) {
			throw new Error('OpenRouter API key is missing. Add it in CleanSlate Settings.');
		}
		if (!model) {
			throw new Error('OpenRouter model is missing. Choose a model in CleanSlate Settings.');
		}

		return this.retryOnRateLimit(async () => {
			const requestProfile = this.getOpenAICompatibleRequestProfile(config, model, 'openrouter', options);
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'openaiCompatible', model, provider: 'openrouter', hasTools: !!options.tools?.length });
			const baseUrl = provider.baseUrl || CLEANSLATE_OPENROUTER_DEFAULT_BASE_URL;
			const event = this.cleanSlateMainService.openAICompatibleChatStream({
				providerName: 'OpenRouter',
				apiKey,
				baseUrl,
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				...requestProfile
			}, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('OpenRouter', model, requestProfile, providerMessages, options, {
				transport: 'openai-compatible',
				baseUrl
			}));
		});
	}

	private async chatCustom(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.custom;
		const model = provider?.model || config.model;
		const baseUrl = provider?.baseUrl?.trim();
		if (!baseUrl) {
			throw new Error('Custom API base URL is missing. Add it in CleanSlate Settings.');
		}
		if (!model) {
			throw new Error('Custom API model is missing. Add it in CleanSlate Settings.');
		}

		return this.retryOnRateLimit(async () => {
			const requestProfile = this.getOpenAICompatibleRequestProfile(config, model, 'custom', options);
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'openaiCompatible', model, provider: 'custom', hasTools: !!options.tools?.length });
			const event = this.cleanSlateMainService.openAICompatibleChatStream({
				providerName: 'Custom API',
				apiKey: provider?.apiKey,
				baseUrl,
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				...requestProfile
			}, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('Custom API', model, requestProfile, providerMessages, options, {
				transport: 'openai-compatible',
				baseUrl
			}));
		});
	}

	private async chatAzureOpenAI(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.azureOpenAI;
		if (!provider?.apiKey) {
			throw new Error('Azure OpenAI API key is missing. Add it in CleanSlate Settings.');
		}
		const endpoint = provider.endpoint?.trim();
		const deploymentName = provider.deploymentName?.trim();
		if (!endpoint) {
			throw new Error('Azure OpenAI endpoint is missing. Add your Azure resource endpoint in CleanSlate Settings.');
		}
		if (!deploymentName) {
			throw new Error('Azure OpenAI deployment name is missing. Add it in CleanSlate Settings.');
		}

		return this.retryOnRateLimit(async () => {
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'openaiCompatible', model: deploymentName, provider: 'azureOpenAI', hasTools: !!options.tools?.length });
			if (this.shouldUseAzureOpenAIV1ChatCompletions(endpoint, deploymentName)) {
				const requestProfile = this.getOpenAICompatibleRequestProfile(config, deploymentName, 'azureFoundry', options);
				const baseUrl = this.toAzureOpenAIV1BaseUrl(endpoint);
				const streamOptions = {
					providerName: 'Azure AI Foundry',
					apiKey: provider.apiKey!,
					baseUrl,
					model: deploymentName,
					messages: providerMessages,
					options: this.getProviderChatOptions(options),
					...requestProfile
				};
				const event = requestProfile.useResponsesApi
					? this.cleanSlateMainService.openAIResponsesStream(streamOptions, this.getChatCancellationToken(options))
					: this.cleanSlateMainService.openAICompatibleChatStream(streamOptions, this.getChatCancellationToken(options));
				return this.parseProviderPartStream(event, this.createProviderDiagnostics('Azure AI Foundry', deploymentName, requestProfile, providerMessages, options, {
					transport: requestProfile.useResponsesApi ? 'openai-responses' : 'openai-compatible',
					baseUrl
				}));
			}

			const requestProfile = this.getOpenAICompatibleRequestProfile(config, deploymentName, 'azureOpenAI', options);
			const azureEndpoint = this.trimTrailingSlash(endpoint);
			const streamOptions = {
				providerName: 'Azure OpenAI',
				apiKey: provider.apiKey!,
				model: deploymentName,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				...requestProfile,
				azure: {
					endpoint: azureEndpoint,
					deploymentName,
					apiVersion: provider.apiVersion || '2024-12-01-preview'
				}
			};
			const event = requestProfile.useResponsesApi
				? this.cleanSlateMainService.openAIResponsesStream(streamOptions, this.getChatCancellationToken(options))
				: this.cleanSlateMainService.openAICompatibleChatStream(streamOptions, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('Azure OpenAI', deploymentName, requestProfile, providerMessages, options, {
				transport: requestProfile.useResponsesApi ? 'openai-responses' : 'azure-openai',
				endpoint: azureEndpoint
			}));
		});
	}

	private async chatAnthropic(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.anthropic;
		const apiKey = provider?.apiKey;
		if (!apiKey) throw new Error('Anthropic API Key is missing. Please add it in CleanSlate Settings.');
		if (!provider?.model) throw new Error('Anthropic model is missing. Choose a model in CleanSlate Settings.');
		const model = provider.model;

		return this.retryOnRateLimit(async () => {
			const requestProfile = this.getProviderRequestProfile(config, 'anthropic', model, undefined, options);
			const capabilities = this.resolveModelCapabilities({
				provider: 'anthropic',
				model,
				planMode: config.planMode,
				reasoningLevel: config.reasoningLevel,
				configuredMaxOutputTokens: config.maxOutputTokens,
				sessionId: options.sessionId
			});
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'anthropic', model, provider: 'anthropic', hasTools: !!options.tools?.length });
			const event = this.cleanSlateMainService.anthropicMessagesStream({
				apiKey,
				baseUrl: provider.baseUrl || 'https://api.anthropic.com/v1',
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				maxOutputTokens: requestProfile.maxOutputTokens,
				temperature: requestProfile.temperature,
				topP: requestProfile.topP,
				thinking: capabilities.thinking
			}, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('Anthropic', model, requestProfile, providerMessages, options, {
				nativeReasoningPayload: this.stringifyReasoningPayload({ thinking: capabilities.thinking })
			}));
		});
	}

	private async chatBedrock(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.bedrock;
		if (!provider?.region) {
			throw new Error('AWS Bedrock region is missing. Add it in CleanSlate Settings.');
		}
		if (!provider.modelId) {
			throw new Error('AWS Bedrock model ID is missing. Choose a model in CleanSlate Settings.');
		}
		if (provider.credentialMode === 'profile' && !provider.profile) {
			throw new Error('AWS Bedrock profile is missing. Add an AWS profile name or use the default credential chain.');
		}
		if (provider.credentialMode === 'accessKey' && (!provider.accessKeyId || !provider.secretAccessKey)) {
			throw new Error('AWS Bedrock access key ID and secret access key are missing. Add them in CleanSlate Settings or use AWS profile/default credentials.');
		}

		const requestProfile = this.getProviderRequestProfile(config, 'bedrock', provider.modelId, undefined, options);
		const capabilities = this.resolveModelCapabilities({
			provider: 'bedrock',
			model: provider.modelId,
			planMode: config.planMode,
			reasoningLevel: config.reasoningLevel,
			configuredMaxOutputTokens: config.maxOutputTokens,
			sessionId: options.sessionId
		});
		const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'bedrock', model: provider.modelId, provider: 'bedrock', hasTools: !!options.tools?.length });
		const event = this.cleanSlateMainService.bedrockConverseStream({
			region: provider.region,
			modelId: provider.modelId,
			credentialMode: provider.credentialMode || 'default',
			profile: provider.profile,
			accessKeyId: provider.accessKeyId,
			secretAccessKey: provider.secretAccessKey,
			sessionToken: provider.sessionToken,
			messages: providerMessages,
			options: this.getProviderChatOptions(options),
			maxOutputTokens: requestProfile.maxOutputTokens,
			temperature: requestProfile.temperature,
			topP: requestProfile.topP,
			additionalModelRequestFields: capabilities.additionalModelRequestFields
		}, this.getChatCancellationToken(options));
		return this.parseProviderPartStream(event, this.createProviderDiagnostics('AWS Bedrock', provider.modelId, requestProfile, providerMessages, options, {
			nativeReasoningPayload: this.stringifyReasoningPayload({ additionalModelRequestFields: capabilities.additionalModelRequestFields })
		}));
	}

	private createProviderDiagnostics(
		providerName: string,
		model: string,
		requestProfile: IOpenAICompatibleRequestProfile,
		messages: IChatMessage[],
		options: IChatOptions,
		request?: Pick<IProviderRequestDiagnostics, 'transport' | 'baseUrl' | 'endpoint' | 'nativeReasoningPayload'>
	): IProviderRequestDiagnostics {
		const inputChars = this.estimateMessagesTextLength(messages) + this.estimateToolDefinitionsTextLength(options.tools);
		const diagnostics = {
			providerName,
			model,
			messageCount: messages.length,
			toolCount: options.tools?.length ?? 0,
			inputChars,
			estimatedInputTokens: Math.ceil(inputChars / 4),
			transport: request?.transport,
			baseUrl: request?.baseUrl,
			endpoint: request?.endpoint,
			nativeReasoningPayload: request?.nativeReasoningPayload ?? this.stringifyReasoningPayload(requestProfile),
			reasoningLevel: requestProfile.reasoningLevel,
			maxOutputTokens: requestProfile.maxOutputTokens,
			useMaxCompletionTokens: requestProfile.useMaxCompletionTokens,
			useResponsesApi: requestProfile.useResponsesApi,
			includeSamplingParameters: requestProfile.includeSamplingParameters,
			temperature: requestProfile.temperature,
			topP: requestProfile.topP,
			topK: requestProfile.topK,
			reasoningEffort: requestProfile.reasoningEffort,
			parallelToolCalls: requestProfile.parallelToolCalls
		};
		this.logProviderRequest(diagnostics);
		return diagnostics;
	}

	private logProviderRequest(diagnostics: IProviderRequestDiagnostics): void {
		this.logger.info(`[CleanSlateService] request provider=${diagnostics.providerName} model=${diagnostics.model} transport=${diagnostics.transport ?? 'default'} reasoning=${diagnostics.reasoningLevel} nativeReasoning=${diagnostics.nativeReasoningPayload ?? 'none'} messages=${diagnostics.messageCount} inputChars=${diagnostics.inputChars} estimatedInputTokens=${diagnostics.estimatedInputTokens} maxOutput=${diagnostics.maxOutputTokens ?? 'default'} maxCompletion=${diagnostics.useMaxCompletionTokens ? 'yes' : 'no'} sampling=${diagnostics.includeSamplingParameters ? 'yes' : 'no'} temperature=${diagnostics.temperature ?? 'default'} topP=${diagnostics.topP ?? 'default'} topK=${diagnostics.topK ?? 'default'} tools=${diagnostics.toolCount}`);
	}

	private stringifyReasoningPayload(payload: Record<string, any>): string | undefined {
		const keys = ['reasoningEffort', 'reasoningSummary', 'include', 'bodyOptions', 'thinkingConfig', 'thinking', 'additionalModelRequestFields'];
		const cleaned = Object.fromEntries(keys
			.map(key => [key, payload[key]])
			.filter(([, value]) => value !== undefined));
		if (Object.keys(cleaned).length === 0) {
			return undefined;
		}
		return JSON.stringify(cleaned);
	}

	private estimateMessagesTextLength(messages: IChatMessage[]): number {
		return messages.reduce((total, message) => total + this.estimateMessageContentLength(message.content), 0);
	}

	private estimateToolDefinitionsTextLength(tools: IChatOptions['tools']): number {
		if (!Array.isArray(tools) || tools.length === 0) {
			return 0;
		}
		try {
			return JSON.stringify(tools).length;
		} catch {
			return 0;
		}
	}

	private estimateMessageContentLength(content: IChatMessage['content']): number {
		if (typeof content === 'string') {
			return content.length;
		}
		if (!Array.isArray(content)) {
			return 0;
		}
		return content.reduce((total, part) => {
			if (part?.type === 'text' && typeof part.text === 'string') {
				return total + part.text.length;
			}
			return total + JSON.stringify(part).length;
		}, 0);
	}

	private async * parseProviderPartStream(event: Subscribable<VSBuffer | string | null>, diagnostics?: IProviderRequestDiagnostics): AsyncIterable<CleanSlateResponsePart> {
		const decoder = new TextDecoder();
		let buffer = '';
		const startedAt = Date.now();
		let firstPartLogged = false;
		let emittedParts = 0;
		let emittedTextChars = 0;
		let emittedReasoningChars = 0;

		const iterable = this.toAsyncIterableFromEvent(event);
		try {
			for await (const chunk of iterable) {
				buffer += decoder.decode(chunk, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';
				for (const line of lines) {
					const s = line.trim();
					if (!s || !s.startsWith('data:')) {
						continue;
					}
					const dataStr = s.startsWith('data: ') ? s.substring(6).trim() : s.substring(5).trim();
					if (!dataStr) {
						continue;
					}
					try {
						const json = JSON.parse(dataStr);
						if (json?.type === 'text' && typeof json.content === 'string') {
							if (!firstPartLogged) {
								firstPartLogged = true;
								this.logProviderTiming('first-part', diagnostics, startedAt, emittedParts);
							}
							emittedParts++;
							emittedTextChars += json.content.length;
							yield {
								type: 'text',
								content: json.content,
								...(json.phase === 'commentary' || json.phase === 'final_answer' ? { phase: json.phase } : {})
							};
						} else if (json?.type === 'reasoning' && typeof json.content === 'string') {
							emittedParts++;
							emittedReasoningChars += json.content.length;
							yield { type: 'reasoning', content: json.content };
						} else if (json?.type === 'usage') {
							this.logProviderReportedUsage(diagnostics, json.usage);
						} else if (json?.type === 'tool_call' && json.call?.toolName) {
							if (!firstPartLogged) {
								firstPartLogged = true;
								this.logProviderTiming('first-part', diagnostics, startedAt, emittedParts);
							}
							emittedParts++;
							yield { type: 'tool_call', call: json.call };
						}
					} catch (error) {
						this.logger.error(`[CleanSlateService] Failed to parse provider stream event: ${String(error)}`);
					}
				}
			}
		} catch (error) {
			throw this.decorateProviderStreamError(error, diagnostics);
		} finally {
			this.logProviderTiming('complete', diagnostics, startedAt, emittedParts, emittedTextChars, emittedReasoningChars);
		}
	}

	private decorateProviderStreamError(error: unknown, diagnostics: IProviderRequestDiagnostics | undefined): Error {
		const message = error instanceof Error ? error.message : String(error);
		if (!diagnostics) {
			return error instanceof Error ? error : new Error(message);
		}

		if (this.isAzureDeploymentMissingError(message)) {
			const target = this.formatProviderEndpointForError(diagnostics.baseUrl || diagnostics.endpoint);
			const isFoundry = diagnostics.providerName === 'Azure AI Foundry';
			const providerLabel = isFoundry ? 'Azure AI Foundry' : diagnostics.providerName;
			const guidance = isFoundry
				? 'For Azure-hosted Grok, Kimi, DeepSeek, Qwen, Mistral, Llama, or Cohere deployments, use the Target URI from Foundry > Deployments > Endpoint, usually https://<resource>.services.ai.azure.com/openai/v1/, and use the exact Deployment Name from that same page.'
				: 'Use the exact Azure deployment name from the same Azure OpenAI resource endpoint.';
			return new Error(`${providerLabel} could not find deployment "${diagnostics.model}" on ${target}. ${guidance} Original provider error: ${message}`);
		}

		return error instanceof Error ? error : new Error(message);
	}

	private isAzureDeploymentMissingError(message: string): boolean {
		const normalized = message.toLowerCase();
		return normalized.includes('deploymentnotfound')
			|| normalized.includes('api deployment for this resource does not exist')
			|| (normalized.includes('404') && normalized.includes('deployment'));
	}

	private formatProviderEndpointForError(endpoint: string | undefined): string {
		if (!endpoint) {
			return 'the configured endpoint';
		}
		try {
			const url = new URL(endpoint);
			url.username = '';
			url.password = '';
			url.search = '';
			url.hash = '';
			return url.toString();
		} catch {
			return endpoint;
		}
	}

	private logProviderTiming(stage: 'first-part' | 'complete', diagnostics: IProviderRequestDiagnostics | undefined, startedAt: number, emittedParts: number, emittedTextChars = 0, emittedReasoningChars = 0): void {
		if (!diagnostics) {
			return;
		}
		const elapsedMs = Date.now() - startedAt;
		const estimatedOutputTokens = Math.ceil((emittedTextChars + emittedReasoningChars) / 4);
		const message = `[CleanSlateService] provider=${diagnostics.providerName} model=${diagnostics.model} stage=${stage} elapsedMs=${elapsedMs} reasoning=${diagnostics.reasoningLevel} nativeReasoning=${diagnostics.nativeReasoningPayload ?? 'none'} messages=${diagnostics.messageCount} tools=${diagnostics.toolCount} inputChars=${diagnostics.inputChars} estimatedInputTokens=${diagnostics.estimatedInputTokens} outputChars=${emittedTextChars + emittedReasoningChars} estimatedOutputTokens=${estimatedOutputTokens} emittedParts=${emittedParts} maxOutput=${diagnostics.maxOutputTokens ?? 'default'} maxCompletion=${diagnostics.useMaxCompletionTokens ? 'yes' : 'no'} sampling=${diagnostics.includeSamplingParameters ? 'yes' : 'no'} temperature=${diagnostics.temperature ?? 'default'} topP=${diagnostics.topP ?? 'default'} topK=${diagnostics.topK ?? 'default'} effort=${diagnostics.reasoningEffort ?? 'none'} parallelTools=${diagnostics.parallelToolCalls ? 'yes' : 'default'}`;
		if (stage === 'complete' && (diagnostics.providerName === 'Azure AI Foundry' || diagnostics.providerName === 'Azure OpenAI')) {
			this.logger.info(`[CleanSlateAzureDebug] ${message}`);
			return;
		}
		this.logger.debug(message);
	}

	private logProviderReportedUsage(diagnostics: IProviderRequestDiagnostics | undefined, usage: any): void {
		if (!diagnostics || (diagnostics.providerName !== 'Azure AI Foundry' && diagnostics.providerName !== 'Azure OpenAI')) {
			return;
		}
		const numberOrUnknown = (value: unknown): number | 'unknown' => typeof value === 'number' && Number.isFinite(value)
			? Math.floor(value)
			: 'unknown';
		this.logger.info(`[CleanSlateAzureDebug] provider=${diagnostics.providerName} model=${diagnostics.model} reportedInputTokens=${numberOrUnknown(usage?.inputTokens)} reportedOutputTokens=${numberOrUnknown(usage?.outputTokens)} reportedTotalTokens=${numberOrUnknown(usage?.totalTokens)} cachedInputTokens=${numberOrUnknown(usage?.cachedInputTokens)}`);
	}

	private async * toAsyncIterableFromEvent(event: Subscribable<VSBuffer | string | null>): AsyncIterable<Uint8Array> {
		const queue: Uint8Array[] = [];
		let done = false;
		let error: any = null;
		let resolve: (() => void) | null = null;

		const disposable = event(data => {
			if (data === null) {
				done = true;
			} else if (typeof data === 'string' && data.startsWith('ERROR: ')) {
				error = new Error(data.substring(7));
				done = true;
			} else {
				let chunk: Uint8Array | undefined;
				if (typeof data === 'string') {
					chunk = new TextEncoder().encode(data);
				} else if (data) {
					chunk = data.buffer;
				}

				if (chunk) {
					queue.push(chunk);
				}
			}

			if (resolve) {
				resolve();
				resolve = null;
			}
		});

		try {
			while (!done || queue.length > 0) {
				if (queue.length === 0 && !done) {
					await new Promise<void>(res => resolve = res);
				}
				while (queue.length > 0) {
					yield queue.shift()!;
				}
				if (error) throw error;
			}
			if (error) {
				throw error;
			}
		} finally {
			disposable.dispose();
		}
	}
	private async chatGemini(messages: IChatMessage[], config: ICleanSlateConfiguration, options: IChatOptions = {}): Promise<AsyncIterable<CleanSlateResponsePart>> {
		const provider = config.providers?.gemini;
		const apiKey = provider?.apiKey;
		if (!apiKey) {
			throw new Error('Google API Key is missing. Please add it in CleanSlate Settings.');
		}

		const model = provider?.model;
		if (!model) {
			throw new Error('Gemini model is missing. Choose a model in CleanSlate Settings.');
		}

		return this.retryOnRateLimit(async () => {
			const requestProfile = this.getProviderRequestProfile(config, 'gemini', model, undefined, options);
			const capabilities = this.resolveModelCapabilities({
				provider: 'gemini',
				model,
				planMode: config.planMode,
				reasoningLevel: config.reasoningLevel,
				configuredMaxOutputTokens: config.maxOutputTokens,
				sessionId: options.sessionId
			});
			const providerMessages = normalizeCleanSlateMessagesForProvider(messages, { target: 'gemini', model, provider: 'gemini', hasTools: !!options.tools?.length });
			const event = this.cleanSlateMainService.geminiGenerateContentStream({
				apiKey,
				model,
				messages: providerMessages,
				options: this.getProviderChatOptions(options),
				maxOutputTokens: requestProfile.maxOutputTokens,
				temperature: requestProfile.temperature,
				topP: requestProfile.topP,
				topK: requestProfile.topK,
				thinkingConfig: capabilities.thinkingConfig
			}, this.getChatCancellationToken(options));
			return this.parseProviderPartStream(event, this.createProviderDiagnostics('Google Gemini', model, requestProfile, providerMessages, options, {
				nativeReasoningPayload: this.stringifyReasoningPayload({ thinkingConfig: capabilities.thinkingConfig })
			}));
		});
	}

	private async * retryOnRateLimit(factory: () => Promise<AsyncIterable<CleanSlateResponsePart>>, maxRetries = 5): AsyncIterable<CleanSlateResponsePart> {
		let pendingRecoveryAttempt: number | undefined;
		for (let i = 0; i <= maxRetries; i++) {
			try {
				const iterable = await factory();
				for await (const item of iterable) {
					if (pendingRecoveryAttempt !== undefined) {
						yield {
							type: 'transport_status',
							status: {
								state: 'recovered',
								attempt: pendingRecoveryAttempt,
								maxAttempts: maxRetries
							}
						};
						pendingRecoveryAttempt = undefined;
					}
					yield item;
				}
				return;
			} catch (e: any) {
				const errorMessage = e.message || String(e);
				if (this.isProviderQuotaExhaustedError(errorMessage)) {
					this.logger.warn?.(`[CleanSlateService] Provider quota exhausted: ${errorMessage}`);
					throw e;
				}
				const isRateLimit = errorMessage.includes('429') || errorMessage.includes('Too Many Requests') || errorMessage.includes('too_many_requests');
				const isRetryableError = errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503') || errorMessage.includes('504');

				if ((isRateLimit || isRetryableError) && i < maxRetries) {
					// Honor the provider's Retry-After duration when present.
					// Short retries within the same Azure TPM window only repeat
					// the 429 and look like an endless reconnect loop.
					const providerDelay = isRateLimit ? this.providerRetryDelayMs(errorMessage) : undefined;
					const baseDelay = isRateLimit ? 3000 : 1000;
					const delay = providerDelay ?? Math.min(60000, Math.pow(2, i) * baseDelay + Math.random() * 1000);
					const attempt = i + 1;

					console.warn(`[CleanSlateService] Request failed with ${errorMessage}. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
					yield {
						type: 'transport_status',
						status: {
							state: 'retrying',
							attempt,
							maxAttempts: maxRetries,
							delayMs: Math.round(delay),
							message: errorMessage
						}
					};
					pendingRecoveryAttempt = attempt;
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				}
				throw e;
			}
		}
	}

	private providerRetryDelayMs(message: string): number | undefined {
		const match = /retry(?:ing)?\s+(?:is\s+available\s+)?(?:in|after)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?)?/i.exec(message);
		if (!match) {
			return undefined;
		}
		const value = Number(match[1]);
		if (!Number.isFinite(value) || value <= 0) {
			return undefined;
		}
		const milliseconds = match[2]?.toLowerCase().startsWith('m') ? value : value * 1000;
		return Math.min(300_000, Math.max(1000, Math.ceil(milliseconds)));
	}

	private isProviderQuotaExhaustedError(message: string): boolean {
		const normalized = message.toLowerCase();
		return normalized.includes('quota_exceeded:')
			|| normalized.includes('you exceeded your current quota')
			|| normalized.includes('quota exceeded for metric')
			|| normalized.includes('generate_content_free_tier_requests')
			|| normalized.includes('google.rpc.quotafailure')
			|| normalized.includes('quotafailure')
			|| (normalized.includes('resource_exhausted') && normalized.includes('quota'))
			// CleanSlate managed plan limits reset on their own; the backend
			// signals them with a 429 usage_limit_exceeded. This is NOT a
			// transient provider rate limit — retrying just loops forever, so
			// treat it as terminal and let the quota card surface instead.
			|| normalized.includes('usage_limit_exceeded')
			|| normalized.includes('usage limit');
	}

}
