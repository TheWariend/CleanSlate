/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Disposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { AIProvider, ICleanSlateConfiguration, ICleanSlateConfigurationService, ICleanSlateService } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import type { ICleanSlateMainService } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import type { ICleanSlateModelsDevModelMetadata } from '@cleanslate/sdk/protocol/cleanSlateAI.js';
import { CleanSlateOpenAICompatibleProviderFlavor, ICleanSlateReasoningLevelOption, resolveCleanSlateReasoningLevelOptions } from '@cleanslate/sdk/protocol/cleanSlateModelCapabilities.js';

export interface ICleanSlateModelDropdownState {
    provider: AIProvider;
    model?: string;
    label: string;
    warning: boolean;
}

export interface ICleanSlateModelSelectorState {
    provider: AIProvider;
    currentModel?: string;
    models: string[];
    configured: boolean;
    configMessage?: string;
    configAction?: 'settings' | 'upgrade';
    errorMessage?: string;
    /** Managed model ids that are usable only with credits (server-enforced). */
    creditsOnlyModels?: string[];
    /** Whether the account currently holds usage credits. */
    hasCredits?: boolean;
}

export interface ICleanSlateReasoningSelectorState {
    provider: AIProvider;
    model?: string;
    options: ICleanSlateReasoningLevelOption[];
}

export class CleanSlateChatModelProvider extends Disposable {
    private state: ICleanSlateModelDropdownState;
    private readonly _onDidChangeState = new Emitter<ICleanSlateModelDropdownState>();
    readonly onDidChangeState: Event<ICleanSlateModelDropdownState> = this._onDidChangeState.event;
    private readonly modelListCache = new Map<AIProvider, string[]>();
    private readonly selectorStateCache = new Map<AIProvider, ICleanSlateModelSelectorState>();
    /** Cached models.dev metadata keyed by `${provider}:${model}` for the reasoning picker. */
    private readonly modelsDevMetadataCache = new Map<string, ICleanSlateModelsDevModelMetadata | undefined>();
    private refreshTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    constructor(
        private readonly cleanSlateService: ICleanSlateService,
        private readonly configService: ICleanSlateConfigurationService,
        private readonly cleanSlateMainService?: ICleanSlateMainService
    ) {
        super();
        this._register(this._onDidChangeState);
        this._register(toDisposable(() => {
            if (this.refreshTimer !== undefined) {
                globalThis.clearTimeout(this.refreshTimer);
                this.refreshTimer = undefined;
            }
        }));
        const config = this.configService.getConfiguration();
        this.state = {
            provider: config.provider,
            model: this.getConfiguredModel(config.provider, config),
            label: this.getInitialLabel(config),
            warning: false
        };
        this._register(this.configService.onDidChangeConfiguration(() => {
            this.clearModelCache(this.configService.getConfiguration().provider);
            this.scheduleRefresh();
        }));
    }

    getState(): ICleanSlateModelDropdownState {
        return this.state;
    }

    getCachedSelectorState(provider: AIProvider): ICleanSlateModelSelectorState | undefined {
        const cached = this.selectorStateCache.get(provider);
        return cached ? this.cloneSelectorState(cached) : undefined;
    }

    getProviderOptions(): readonly AIProvider[] {
        return ['cleanslate', 'openai', 'azureOpenAI', 'anthropic', 'gemini', 'grok', 'bedrock', 'nvidia', 'openrouter', 'custom'];
    }

    getReasoningSelectorState(): ICleanSlateReasoningSelectorState {
        const config = this.configService.getConfiguration();
        const provider = config.provider;
        const model = this.getConfiguredModel(provider, config) ?? config.model;
        return {
            provider,
            model,
            options: resolveCleanSlateReasoningLevelOptions({
                provider,
                model,
                flavor: this.getOpenAICompatibleFlavor(provider, config),
                modelsDevMetadata: this.getCachedModelsDevMetadata(provider, model)
            })
        };
    }

    /**
     * Returns cached models.dev metadata for the current provider/model, or undefined when not
     * cached yet. Kicks off a one-shot fetch through the main process so the next call after the
     * metadata arrives sees the real capability data.
     */
    private getCachedModelsDevMetadata(provider: AIProvider, model?: string): ICleanSlateModelsDevModelMetadata | undefined {
        if (!model || !this.cleanSlateMainService?.getModelsDevModelMetadata) {
            return undefined;
        }
        const cacheKey = `${provider}:${model}`;
        if (this.modelsDevMetadataCache.has(cacheKey)) {
            return this.modelsDevMetadataCache.get(cacheKey);
        }
        this.modelsDevMetadataCache.set(cacheKey, undefined);
        const mainService = this.cleanSlateMainService;
        void mainService.getModelsDevModelMetadata(provider, model, CancellationToken.None).then(metadata => {
            const hadMetadata = this.modelsDevMetadataCache.get(cacheKey) !== undefined;
            this.modelsDevMetadataCache.set(cacheKey, metadata);
            // Re-render the reasoning picker now that real capability data is available.
            if (!hadMetadata) {
                this._onDidChangeState.fire(this.state);
            }
        }, () => {
            // Keep the undefined placeholder so we do not retry in a loop on failure.
        });
        return undefined;
    }

    formatModelLabel(name: string): string {
        if (name.includes(':') || name.includes('/')) {
            return name;
        }

        const glmVersion = /^glm[- ]?(\d+(?:\.\d+)*)$/i.exec(name);
        if (glmVersion) {
            return `GLM ${glmVersion[1]}`;
        }

        const sarvamSize = /^sarvam[- ]?(\d+)b$/i.exec(name);
        if (sarvamSize) {
            return `Sarvam ${sarvamSize[1]}B`;
        }

        let trimmed = name.replace(/-(latest|preview|exp|02-05|2024\d+|2025\d+)$/i, '')
            .replace(/-/g, ' ');

        trimmed = trimmed.replace(/^deepseek\b/i, 'DeepSeek');

        if (/^(gpt|claude|llama|o1|o3)\s?/i.test(trimmed)) {
            const parts = trimmed.split(' ');
            if (parts.length > 1) {
                // If it's something like "gpt 4o" or "o1 preview", try to just show "4o" or "o1"
                if (/^(4o|4|4\.\d|5\.\d|3\.5|o1|o3)$/i.test(parts[1])) {
                    trimmed = parts.slice(1).join(' ');
                }
            }
        }

        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }

    async refresh(): Promise<void> {
        const config = await this.configService.getResolvedConfiguration();

        try {
            const models = await this.getModels(config.provider);
            const configured = this.isConfigured(config.provider, config);

            let label = 'Unknown';
            let warning = false;
            let selectedModel: string | undefined;

            if (!configured) {
                label = 'Setup Required';
                warning = true;
            } else if (!models.length) {
                label = 'No Models';
                warning = true;
            } else {
                const configuredModel = this.getConfiguredModel(config.provider, config);
                selectedModel = configuredModel && models.includes(configuredModel)
                    ? configuredModel
                    : models[0];
                
                label = this.formatModelLabel(selectedModel);
            }

            this.state = {
                provider: config.provider,
                model: selectedModel,
                label,
                warning
            };
            this._onDidChangeState.fire(this.state);
        } catch (error) {
            console.error('Failed to load models:', error);
            const configuredModel = this.getConfiguredModel(config.provider, config);
            this.state = {
                provider: config.provider,
                model: configuredModel,
                label: configuredModel ? this.formatModelLabel(configuredModel) : 'Model Error',
                warning: true
            };
            this._onDidChangeState.fire(this.state);
        }
    }

    async getSelectorState(provider: AIProvider): Promise<ICleanSlateModelSelectorState> {
        const config = await this.configService.getResolvedConfiguration();

        if (!this.isConfigured(provider, config)) {
            return this.cacheSelectorState({
                provider,
                currentModel: this.getConfiguredModel(provider, config) ?? config.model,
                models: [],
                configured: false,
                configMessage: this.getConfigMessage(provider, config)
            });
        }

        try {
            const models = await this.getModels(provider);
            if (provider === 'cleanslate' && models.length === 0) {
                const entitlements = await this.configService.getManagedEntitlements();
                const configMessage = !entitlements.managed_ai && !entitlements.plan
                    ? 'Upgrade to CleanSlate Pro to start chatting.'
                    : 'CleanSlate access is unavailable right now.';
                return this.cacheSelectorState({
                    provider,
                    currentModel: undefined,
                    models: [],
                    configured: false,
                    configMessage,
                    configAction: !entitlements.managed_ai && !entitlements.plan ? 'upgrade' : 'settings'
                });
            }
            const displayModels = this.getDisplayModels(provider, models);
            const configuredModel = this.getConfiguredModel(provider, config);
            const currentModel = configuredModel && displayModels.includes(configuredModel) ? configuredModel : undefined;
            let creditsOnlyModels: string[] | undefined;
            let hasCredits: boolean | undefined;
            if (provider === 'cleanslate') {
                const entitlements = await this.configService.getManagedEntitlements().catch(() => undefined);
                if (entitlements) {
                    creditsOnlyModels = (entitlements.models || [])
                        .filter(model => model.requires_credits && !!model.id?.trim())
                        .map(model => model.id.trim());
                    hasCredits = Number(entitlements.credits?.balance_cents || 0) > 0;
                }
            }
            return this.cacheSelectorState({
                provider,
                currentModel,
                models: displayModels,
                configured: true,
                creditsOnlyModels,
                hasCredits
            });
        } catch (error: any) {
            const configuredModel = this.getConfiguredModel(provider, config);
            return {
                provider,
                currentModel: configuredModel,
                models: configuredModel ? [configuredModel] : [],
                configured: true,
                errorMessage: error?.message || 'Failed to fetch models'
            };
        }
    }

    async updateProvider(provider: AIProvider): Promise<void> {
        await this.configService.updateConfiguration({ provider, model: undefined });
        this.clearModelCache();
        await this.refresh();
    }

    async updateModel(model: string): Promise<void> {
        const config = await this.configService.getResolvedConfiguration();
        switch (config.provider) {
            case 'cleanslate':
                await this.configService.updateConfiguration({ providers: { cleanslate: { model } } });
                break;
            case 'azureOpenAI':
                await this.configService.updateConfiguration({ providers: { azureOpenAI: { deploymentName: model } } });
                break;
            case 'anthropic':
                await this.configService.updateConfiguration({ providers: { anthropic: { model } } });
                break;
            case 'gemini':
                await this.configService.updateConfiguration({ providers: { gemini: { model } } });
                break;
            case 'grok':
                await this.configService.updateConfiguration({ providers: { grok: { model } } });
                break;
            case 'bedrock':
                await this.configService.updateConfiguration({ providers: { bedrock: { modelId: model } } });
                break;
            case 'nvidia':
                await this.configService.updateConfiguration({ providers: { nvidia: { model } } });
                break;
            case 'openrouter':
                await this.configService.updateConfiguration({ providers: { openrouter: { model } } });
                break;
            case 'custom':
                await this.configService.updateConfiguration({ providers: { custom: { model } } });
                break;
            case 'openai':
            default:
                await this.configService.updateConfiguration({ providers: { openai: { model } } });
                break;
        }
        this.clearModelCache(config.provider);
        await this.refresh();
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer !== undefined) {
            globalThis.clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        this.refreshTimer = globalThis.setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh();
        }, 0);
    }

    private getInitialLabel(config: ICleanSlateConfiguration): string {
        const configuredModel = this.getConfiguredModel(config.provider, config);
        if (configuredModel) {
            return this.formatModelLabel(configuredModel);
        }
        switch (config.provider) {
            case 'cleanslate':
                return 'CleanSlate';
            case 'openai':
                return 'OpenAI';
            case 'azureOpenAI':
                return 'Azure OpenAI';
            case 'anthropic':
                return 'Anthropic';
            case 'gemini':
                return 'Gemini';
            case 'grok':
                return 'Grok';
            case 'bedrock':
                return 'Bedrock';
            case 'nvidia':
                return 'NVIDIA';
            case 'openrouter':
                return 'OpenRouter';
            case 'custom':
                return 'Custom API';
            default: {
                const exhaustiveCheck: never = config.provider;
                return exhaustiveCheck;
            }
        }
    }

    private async getModels(provider: AIProvider): Promise<string[]> {
        const cached = this.modelListCache.get(provider);
        if (cached) {
            return [...cached];
        }
        const models = await this.cleanSlateService.getModels(provider);
        this.modelListCache.set(provider, [...models]);
        return [...models];
    }

    private clearModelCache(provider?: AIProvider): void {
        if (provider) {
            this.modelListCache.delete(provider);
            this.selectorStateCache.delete(provider);
            return;
        }
        this.modelListCache.clear();
        this.selectorStateCache.clear();
    }

    private cacheSelectorState(state: ICleanSlateModelSelectorState): ICleanSlateModelSelectorState {
        const cached = this.cloneSelectorState(state);
        this.selectorStateCache.set(state.provider, cached);
        return this.cloneSelectorState(cached);
    }

    private cloneSelectorState(state: ICleanSlateModelSelectorState): ICleanSlateModelSelectorState {
        return {
            ...state,
            models: [...state.models],
            creditsOnlyModels: state.creditsOnlyModels ? [...state.creditsOnlyModels] : undefined
        };
    }

    private isConfigured(provider: AIProvider, config: ICleanSlateConfiguration): boolean {
        switch (provider) {
            case 'cleanslate':
                return !!config.providers?.cleanslate?.apiKey;
            case 'openai':
                return !!config.providers?.openai?.apiKey;
            case 'azureOpenAI':
                return !!(config.providers?.azureOpenAI?.apiKey && config.providers.azureOpenAI.endpoint && config.providers.azureOpenAI.deploymentName);
            case 'anthropic':
                return !!config.providers?.anthropic?.apiKey;
            case 'gemini':
                return !!config.providers?.gemini?.apiKey;
            case 'grok':
                return !!config.providers?.grok?.apiKey;
            case 'bedrock': {
                const bedrock = config.providers?.bedrock;
                if (!bedrock?.region || !bedrock.modelId) {
                    return false;
                }
                if (bedrock.credentialMode === 'profile') {
                    return !!bedrock.profile;
                }
                if (bedrock.credentialMode === 'accessKey') {
                    return !!(bedrock.accessKeyId && bedrock.secretAccessKey);
                }
                return true;
            }
            case 'nvidia':
                return !!config.providers?.nvidia?.apiKey;
            case 'openrouter':
                return !!config.providers?.openrouter?.apiKey;
            case 'custom':
                return !!(config.providers?.custom?.baseUrl && config.providers.custom.model);
            default: {
                const exhaustiveCheck: never = provider;
                return exhaustiveCheck;
            }
        }
    }

    private getConfigMessage(provider: AIProvider, config: ICleanSlateConfiguration): string {
        switch (provider) {
            case 'cleanslate':
                return 'Sign in to CleanSlate to use managed models.';
            case 'openai':
                return 'OpenAI API key is missing.';
            case 'azureOpenAI':
                if (!config.providers?.azureOpenAI?.apiKey) {
                    return 'Azure OpenAI API key is missing.';
                }
                if (!config.providers.azureOpenAI.endpoint) {
                    return 'Azure OpenAI endpoint is missing.';
                }
                return 'Azure OpenAI deployment name is missing.';
            case 'anthropic':
                return 'Anthropic API key is missing.';
            case 'gemini':
                return 'Google API key is missing.';
            case 'grok':
                return 'xAI API key is missing.';
            case 'bedrock':
                return 'AWS Bedrock region, model ID, or credentials are missing.';
            case 'nvidia':
                return 'NVIDIA NIM API key is missing.';
            case 'openrouter':
                return 'OpenRouter API key is missing.';
            case 'custom':
                if (!config.providers?.custom?.baseUrl) {
                    return 'Custom API base URL is missing.';
                }
                return 'Custom API model is missing.';
            default: {
                const exhaustiveCheck: never = provider;
                return exhaustiveCheck;
            }
        }
    }

    private getDisplayModels(provider: AIProvider, models: string[]): string[] {
        return models;
    }

    private getConfiguredModel(provider: AIProvider, config: ICleanSlateConfiguration): string | undefined {
        switch (provider) {
            case 'cleanslate':
                return config.providers?.cleanslate?.model;
            case 'openai':
                return config.providers?.openai?.model;
            case 'azureOpenAI':
                return config.providers?.azureOpenAI?.deploymentName;
            case 'anthropic':
                return config.providers?.anthropic?.model;
            case 'gemini':
                return config.providers?.gemini?.model;
            case 'grok':
                return config.providers?.grok?.model;
            case 'bedrock':
                return config.providers?.bedrock?.modelId;
            case 'nvidia':
                return config.providers?.nvidia?.model;
            case 'openrouter':
                return config.providers?.openrouter?.model;
            case 'custom':
                return config.providers?.custom?.model;
            default: {
                const exhaustiveCheck: never = provider;
                return exhaustiveCheck;
            }
        }
    }

    private getOpenAICompatibleFlavor(provider: AIProvider, config: ICleanSlateConfiguration): CleanSlateOpenAICompatibleProviderFlavor | undefined {
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
                return this.isAzureFoundryEndpoint(config.providers?.azureOpenAI?.endpoint)
                    ? 'azureFoundry'
                    : 'azureOpenAI';
            default:
                return undefined;
        }
    }

    private isAzureFoundryEndpoint(value: unknown): boolean {
        const endpoint = typeof value === 'string' ? value.toLowerCase() : '';
        return endpoint.includes('.services.ai.azure.com') || endpoint.includes('/openai/v1');
    }
}
