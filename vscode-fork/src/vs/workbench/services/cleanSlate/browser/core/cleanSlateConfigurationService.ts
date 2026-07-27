/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AIProvider,
    CleanSlateBedrockCredentialMode,
    CleanSlateEmbeddingProvider,
    CleanSlateWebSearchProvider,
    ICleanSlateConfiguration,
    ICleanSlateConfigurationService,
    ICleanSlateLogger,
    ICleanSlateManagedAccount,
    ICleanSlateManagedEntitlements,
    ICleanSlateMainService,
    ICleanSlateProviderConfigurations,
    ICleanSlateWebSearchConfiguration,
    normalizeCleanSlateExecutionState
} from '../../common/core/cleanSlateAI.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Emitter } from '../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CleanSlateOpenAICompatibleProviderFlavor, getCleanSlateContextDefaults, resolveCleanSlateEffectiveReasoningLevel } from '../../common/core/cleanSlateModelCapabilities.js';

type StoredProviderConfigurations = ICleanSlateProviderConfigurations;
type StoredConfiguration = Partial<Omit<ICleanSlateConfiguration, 'providers'>> & { providers?: StoredProviderConfigurations };

const SECRET_KEYS = {
    managedToken: 'cleanSlate.auth.jwt',
    openaiApiKey: 'cleanSlate.provider.openai.apiKey',
    azureOpenAIApiKey: 'cleanSlate.provider.azureOpenAI.apiKey',
    anthropicApiKey: 'cleanSlate.provider.anthropic.apiKey',
    googleApiKey: 'cleanSlate.provider.gemini.apiKey',
    grokApiKey: 'cleanSlate.provider.grok.apiKey',
    nvidiaApiKey: 'cleanSlate.provider.nvidia.apiKey',
    openrouterApiKey: 'cleanSlate.provider.openrouter.apiKey',
    customApiKey: 'cleanSlate.provider.custom.apiKey',
    bedrockAccessKeyId: 'cleanSlate.provider.bedrock.accessKeyId',
    bedrockSecretAccessKey: 'cleanSlate.provider.bedrock.secretAccessKey',
    bedrockSessionToken: 'cleanSlate.provider.bedrock.sessionToken'
} as const;

const CLEANSLATE_DEFAULT_WEB_SEARCH_PROVIDERS: readonly CleanSlateWebSearchProvider[] = ['searxng', 'exaMcpAnonymous', 'parallelMcpAnonymous'];

interface ISecretSnapshot {
    managedToken?: string;
    openaiApiKey?: string;
    azureOpenAIApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
    grokApiKey?: string;
    nvidiaApiKey?: string;
    openrouterApiKey?: string;
    customApiKey?: string;
    bedrockAccessKeyId?: string;
    bedrockSecretAccessKey?: string;
    bedrockSessionToken?: string;
}

export class CleanSlateConfigurationService implements ICleanSlateConfigurationService {

    _serviceBrand: undefined;
    private readonly _onDidChangeConfiguration = new Emitter<ICleanSlateConfiguration>();
    readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

    private static readonly CONFIG_STORAGE_KEY = 'cleanSlate.configuration.v2';
    private static readonly LEGACY_CONFIG_STORAGE_KEY = 'cleanSlate.configuration.v1';
    private static readonly MIGRATION_STORAGE_KEY = 'cleanSlate.configuration.migratedToProviderStorage';
    private static readonly REMOVED_STORED_SETTINGS = new Set(['contextWindow', 'modelContextWindow', 'modelMaxOutputTokens', 'maxInputTokens', 'autoCompactReserveTokens', 'maxOutputTokens', 'fileTruncation', 'globalContextBudget', 'verifyAfterEachEdit', 'executionProfile']);
    private static readonly MANAGED_ACCOUNT_STORAGE_KEY = 'cleanSlate.auth.account';

    private secretCache: ISecretSnapshot = {};
    private readonly initialization: Promise<void>;
    private secretsLoadPromise: Promise<void> | undefined;
    private managedTokenRefresh: Promise<string> | undefined;

    constructor(
        @IConfigurationService private readonly configurationService: IConfigurationService,
        @IStorageService private readonly storageService: IStorageService,
        @ISecretStorageService private readonly secretStorageService: ISecretStorageService,
        @ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService,
        @ICleanSlateLogger private readonly logger: ICleanSlateLogger
    ) {
        this.initialization = this.migrateLegacySettingsConfiguration();
        this.secretsLoadPromise = this.loadSecrets();
        this.secretStorageService.onDidChangeSecret(key => {
            if (key === SECRET_KEYS.managedToken) {
                this.secretsLoadPromise = this.loadSecrets();
                void this.getResolvedConfiguration().then(config => this._onDidChangeConfiguration.fire(config));
            }
        });
    }

    getConfiguration(): ICleanSlateConfiguration {
        return this.normalizeConfiguration(this.readStoredConfiguration(), this.secretCache);
    }

    async getResolvedConfiguration(): Promise<ICleanSlateConfiguration> {
        await this.initialization;
        await this.ensureSecretsLoaded();
        return this.normalizeConfiguration(this.readStoredConfiguration(), this.secretCache);
    }

    async updateConfiguration(config: Partial<ICleanSlateConfiguration>): Promise<void> {
        await this.initialization;
        await this.ensureSecretsLoaded();
        this.logger.info(`Updating CleanSlate configuration: ${Object.keys(config).join(', ')}`);

        const stored = this.readStoredConfiguration();
        const next = this.mergeStoredConfiguration(stored, config);
        await this.writeSecretUpdates(config);

        this.storageService.store(
            CleanSlateConfigurationService.CONFIG_STORAGE_KEY,
            JSON.stringify(next),
            StorageScope.PROFILE,
            StorageTarget.USER
        );
        this._onDidChangeConfiguration.fire(this.normalizeConfiguration(next, this.secretCache));
    }

    refreshManagedToken(rejectedToken?: string): Promise<string> {
        if (!this.managedTokenRefresh) {
            this.managedTokenRefresh = this.doRefreshManagedToken(rejectedToken).finally(() => {
                this.managedTokenRefresh = undefined;
            });
        }
        return this.managedTokenRefresh;
    }

    private async doRefreshManagedToken(rejectedToken?: string): Promise<string> {
        await this.ensureSecretsLoaded();
        const token = this.secretCache.managedToken;
        if (!token) {
            throw new Error('Sign in to CleanSlate again.');
        }
        // Another request or window may already have replaced the rejected
        // token. Reuse the newer credential instead of rotating it again.
        if (rejectedToken && token !== rejectedToken) {
            return token;
        }

        const runtimeConfig = await this.cleanSlateMainService.getRuntimeConfig();
        const response = await this.cleanSlateMainService.proxyRequest({
            url: `${runtimeConfig.apiBaseUrl}/auth/refresh`,
            type: 'POST',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        }, CancellationToken.None);
        const status = response.res.statusCode ?? 0;
        const body = this.parseJson(response.data);
        if (status === 401) {
            throw new Error('Your CleanSlate session expired. Sign in again.');
        }
        if (status < 200 || status >= 300) {
            throw new Error(body?.message || `Unable to refresh the CleanSlate session (${status}). Try again.`);
        }
        if (typeof body?.token !== 'string' || !body.token) {
            throw new Error('CleanSlate received an invalid session-refresh response. Try again.');
        }

        await this.writeSecretFromValue('managedToken', body.token);
        this.updateManagedAccountExpiry(body);
        this._onDidChangeConfiguration.fire(this.normalizeConfiguration(this.readStoredConfiguration(), this.secretCache));
        return body.token;
    }

    async getManagedEntitlements(): Promise<ICleanSlateManagedEntitlements> {
        await this.ensureSecretsLoaded();
        let token = this.secretCache.managedToken;
        if (!token) {
            throw new Error('Sign in to CleanSlate to view your managed models.');
        }
        if (this.isManagedTokenNearExpiry()) {
            token = await this.refreshManagedToken(token);
        }

        const request = async () => {
            const runtimeConfig = await this.cleanSlateMainService.getRuntimeConfig();
            return this.cleanSlateMainService.proxyRequest({
                url: `${runtimeConfig.managedAIBaseUrl}/entitlements`,
                type: 'GET',
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
            }, CancellationToken.None);
        };

        let response = await request();
        if ((response.res.statusCode ?? 0) === 401) {
            token = await this.refreshManagedToken(token);
            response = await request();
        }

        const status = response.res.statusCode ?? 0;
        const body = this.parseJson(response.data);
        if (status < 200 || status >= 300 || !body?.data) {
            throw new Error(body?.message || `Unable to load CleanSlate entitlements (${status}).`);
        }
        const entitlements = body.data as ICleanSlateManagedEntitlements;
        this.syncManagedAccountFromEntitlements(entitlements);
        return entitlements;
    }

    getManagedAccount(): ICleanSlateManagedAccount | undefined {
        const raw = this.storageService.get(CleanSlateConfigurationService.MANAGED_ACCOUNT_STORAGE_KEY, StorageScope.APPLICATION);
        if (!raw) {
            return undefined;
        }
        try {
            const account = JSON.parse(raw);
            return account && typeof account === 'object' ? account as ICleanSlateManagedAccount : undefined;
        } catch {
            return undefined;
        }
    }

    private parseJson(value: string | undefined): any {
        try {
            return JSON.parse(value || '{}');
        } catch {
            return {};
        }
    }

    private isManagedTokenNearExpiry(): boolean {
        const account = this.getManagedAccount();
        const expiresAt = typeof account?.expiresAt === 'string' ? Date.parse(account.expiresAt) : Number.NaN;
        return Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000;
    }

    private updateManagedAccountExpiry(response: any): void {
        const account = this.getManagedAccount();
        if (!account) {
            return;
        }
        const expiresAt = typeof response?.expires_at === 'string' ? response.expires_at : undefined;
        const expiresIn = typeof response?.expires_in === 'number' || typeof response?.expires_in === 'string'
            ? String(response.expires_in)
            : undefined;
        if (!expiresAt && !expiresIn) {
            return;
        }
        this.storageService.store(
            CleanSlateConfigurationService.MANAGED_ACCOUNT_STORAGE_KEY,
            JSON.stringify({ ...account, expiresAt: expiresAt ?? account.expiresAt, expiresIn: expiresIn ?? account.expiresIn }),
            StorageScope.APPLICATION,
            StorageTarget.USER
        );
    }

    /**
     * OAuth callback metadata is useful for immediate feedback, but the quota
     * belongs to the identity in the bearer token. Reconcile the displayed
     * account with that server-authenticated identity after every entitlement
     * lookup so an old browser session can never be labelled as a new account.
     */
    private syncManagedAccountFromEntitlements(entitlements: ICleanSlateManagedEntitlements): void {
        const authenticated = entitlements.account;
        if (!authenticated?.email && !authenticated?.name && !authenticated?.avatar_url) {
            return;
        }

        const current = this.getManagedAccount() || {};
        this.storageService.store(
            CleanSlateConfigurationService.MANAGED_ACCOUNT_STORAGE_KEY,
            JSON.stringify({
                ...current,
                email: authenticated.email || current.email,
                name: authenticated.name || current.name,
                profileImageUrl: authenticated.avatar_url || current.profileImageUrl,
            }),
            StorageScope.APPLICATION,
            StorageTarget.MACHINE
        );
    }

    private normalizeConfiguration(config: StoredConfiguration, secrets: ISecretSnapshot): ICleanSlateConfiguration {
        const provider = this.normalizeProvider(config.provider);
        const providers = this.normalizeProviders(config.providers || {}, config, secrets);
        const active = this.getActiveProviderConfiguration(provider, providers);
        const embeddingProvider = this.normalizeEmbeddingProvider(config.embeddingProvider, provider, providers);
        const rawEmbeddingModel = embeddingProvider === 'azureOpenAI'
            ? providers.azureOpenAI?.embeddingDeploymentName
            : config.embeddingModel;
        const embeddingModel = this.normalizeEmbeddingModel(embeddingProvider, rawEmbeddingModel);

        let executionState = normalizeCleanSlateExecutionState({
            planMode: config.planMode,
            reasoningLevel: config.reasoningLevel
        });
        const capabilityProvider = provider;
        const capabilityModel = active.model;
        const capabilityFlavor = this.getOpenAICompatibleFlavor(provider, providers);
        executionState = normalizeCleanSlateExecutionState({
            planMode: executionState.planMode,
            reasoningLevel: resolveCleanSlateEffectiveReasoningLevel({
                provider: capabilityProvider,
                model: capabilityModel,
                flavor: capabilityFlavor,
                reasoningLevel: executionState.reasoningLevel
            })
        });
        const contextDefaults = getCleanSlateContextDefaults({
            provider: capabilityProvider,
            model: capabilityModel,
            flavor: capabilityFlavor,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel
        });

        return {
            ...config,
            provider,
            providers,
            model: active.model,
            embeddingProvider,
            embeddingModel,
            apiKey: active.apiKey,
            openaiApiKey: providers.openai?.apiKey,
            azureOpenAIApiKey: providers.azureOpenAI?.apiKey,
            azureOpenAIEndpoint: providers.azureOpenAI?.endpoint,
            azureOpenAIApiVersion: providers.azureOpenAI?.apiVersion,
            azureOpenAIDeploymentName: providers.azureOpenAI?.deploymentName,
            azureOpenAIEmbeddingDeploymentName: providers.azureOpenAI?.embeddingDeploymentName,
            anthropicApiKey: providers.anthropic?.apiKey,
            googleApiKey: providers.gemini?.apiKey,
            grokApiKey: providers.grok?.apiKey,
            grokBaseUrl: providers.grok?.baseUrl,
            nvidiaApiKey: providers.nvidia?.apiKey,
            nvidiaBaseUrl: providers.nvidia?.baseUrl,
            openrouterApiKey: providers.openrouter?.apiKey,
            openrouterBaseUrl: providers.openrouter?.baseUrl,
            customApiKey: providers.custom?.apiKey,
            customBaseUrl: providers.custom?.baseUrl,
            bedrockRegion: providers.bedrock?.region,
            bedrockCredentialMode: providers.bedrock?.credentialMode,
            bedrockProfile: providers.bedrock?.profile,
            bedrockAccessKeyId: providers.bedrock?.accessKeyId,
            bedrockSecretAccessKey: providers.bedrock?.secretAccessKey,
            bedrockSessionToken: providers.bedrock?.sessionToken,
            bedrockModelId: providers.bedrock?.modelId,
            baseUrl: provider === 'azureOpenAI'
                ? providers.azureOpenAI?.endpoint
                : provider === 'cleanslate'
                    ? providers.cleanslate?.baseUrl
                : provider === 'grok'
                    ? providers.grok?.baseUrl
                    : provider === 'nvidia'
                        ? providers.nvidia?.baseUrl
                        : provider === 'openrouter'
                            ? providers.openrouter?.baseUrl
                            : provider === 'custom'
                                ? providers.custom?.baseUrl
                                : provider === 'anthropic'
                                    ? providers.anthropic?.baseUrl
                                    : providers.openai?.baseUrl,
            ragEnabled: config.ragEnabled !== undefined ? config.ragEnabled : true,
            webSearch: this.normalizeWebSearchConfiguration(config.webSearch),
            contextWindow: contextDefaults.contextWindowTokens,
            modelContextWindow: contextDefaults.modelContextWindowTokens,
            modelMaxOutputTokens: contextDefaults.modelMaxOutputTokens,
            maxInputTokens: contextDefaults.maxInputTokens,
            autoCompactReserveTokens: contextDefaults.autoCompactReserveTokens,
            maxOutputTokens: undefined,
            fileTruncation: contextDefaults.fileTruncationChars,
            globalContextBudget: contextDefaults.globalContextBudgetChars,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            maxTurns: Number.isFinite(config.maxTurns) && config.maxTurns! > 0 ? Math.floor(config.maxTurns!) : undefined,
            maxNoToolTurns: Number.isFinite(config.maxNoToolTurns) ? Math.max(1, Math.floor(config.maxNoToolTurns!)) : (executionState.planMode ? 3 : 2),
            maxVerificationRetries: Number.isFinite(config.maxVerificationRetries) ? Math.max(0, Math.floor(config.maxVerificationRetries!)) : (executionState.planMode ? 2 : 1),
            verificationCommands: Array.isArray(config.verificationCommands)
                ? config.verificationCommands.filter((command: unknown) => typeof command === 'string' && command.trim().length > 0)
                : [],
            failOnWarnings: config.failOnWarnings !== undefined ? !!config.failOnWarnings : false
        };
    }

    private normalizeWebSearchConfiguration(config: ICleanSlateWebSearchConfiguration | undefined): ICleanSlateWebSearchConfiguration {
        const configuredProviders = Array.isArray(config?.providerOrder)
            ? config.providerOrder.filter((provider): provider is CleanSlateWebSearchProvider => CLEANSLATE_DEFAULT_WEB_SEARCH_PROVIDERS.includes(provider as CleanSlateWebSearchProvider))
            : [];
        const providerOrder = configuredProviders.length > 0
            ? Array.from(new Set(configuredProviders))
            : [...CLEANSLATE_DEFAULT_WEB_SEARCH_PROVIDERS];

        return {
            enabled: config?.enabled !== undefined ? !!config.enabled : true,
            mode: 'freeOnly',
            providerOrder,
            searxngBaseUrl: typeof config?.searxngBaseUrl === 'string' && config.searxngBaseUrl.trim().length > 0
                ? config.searxngBaseUrl.trim()
                : undefined,
            includeAnonymousHostedProviders: config?.includeAnonymousHostedProviders !== undefined
                ? !!config.includeAnonymousHostedProviders
                : true,
            hardStopOnQuota: config?.hardStopOnQuota !== undefined ? !!config.hardStopOnQuota : true,
            maxResults: Number.isFinite(config?.maxResults) ? Math.min(20, Math.max(1, Math.floor(config!.maxResults!))) : 8,
            timeoutMs: Number.isFinite(config?.timeoutMs) ? Math.min(60_000, Math.max(5_000, Math.floor(config!.timeoutMs!))) : 25_000
        };
    }

    private normalizeProviders(config: StoredProviderConfigurations, legacy: StoredConfiguration, secrets: ISecretSnapshot): ICleanSlateProviderConfigurations {
        const provider = this.normalizeProvider(legacy.provider);
        const legacyValues = legacy as Record<string, any>;
        const isLegacyAzure = this.isAzureEndpoint(legacy.baseUrl || legacyValues.azureOpenAIApiBaseUrl || legacyValues.azureBaseUrl || legacyValues.azureEndpoint);

        return {
            cleanslate: {
                ...config.cleanslate,
                model: config.cleanslate?.model || (provider === 'cleanslate' ? legacy.model : undefined) || 'gpt-5.4',
                baseUrl: config.cleanslate?.baseUrl,
                apiKey: secrets.managedToken
            },
            openai: {
                ...config.openai,
                model: config.openai?.model || (!isLegacyAzure && provider === 'openai' ? legacy.model : undefined),
                baseUrl: config.openai?.baseUrl || (!isLegacyAzure ? legacyValues.openaiBaseUrl : undefined),
                apiKey: secrets.openaiApiKey
            },
            azureOpenAI: {
                ...config.azureOpenAI,
                endpoint: config.azureOpenAI?.endpoint || (isLegacyAzure ? (legacy.baseUrl || legacyValues.azureOpenAIApiBaseUrl || legacyValues.azureBaseUrl || legacyValues.azureEndpoint) : undefined),
                deploymentName: config.azureOpenAI?.deploymentName || (isLegacyAzure ? legacy.model : undefined),
                apiVersion: config.azureOpenAI?.apiVersion || legacyValues.azureOpenAIApiVersion || '2024-12-01-preview',
                embeddingDeploymentName: config.azureOpenAI?.embeddingDeploymentName || (isLegacyAzure ? legacy.embeddingModel : undefined),
                apiKey: secrets.azureOpenAIApiKey
            },
            anthropic: {
                ...config.anthropic,
                model: config.anthropic?.model || (provider === 'anthropic' ? legacy.model : undefined),
                baseUrl: config.anthropic?.baseUrl,
                apiKey: secrets.anthropicApiKey
            },
            gemini: {
                ...config.gemini,
                model: config.gemini?.model || (provider === 'gemini' ? legacy.model : undefined),
                apiKey: secrets.googleApiKey
            },
            grok: {
                ...config.grok,
                model: config.grok?.model || (provider === 'grok' ? legacy.model : undefined),
                baseUrl: config.grok?.baseUrl || legacyValues.grokBaseUrl || 'https://api.x.ai/v1',
                apiKey: secrets.grokApiKey
            },
            nvidia: {
                ...config.nvidia,
                model: config.nvidia?.model || (provider === 'nvidia' ? legacy.model : undefined),
                baseUrl: config.nvidia?.baseUrl || legacyValues.nvidiaBaseUrl,
                apiKey: secrets.nvidiaApiKey
            },
            openrouter: {
                ...config.openrouter,
                model: config.openrouter?.model || (provider === 'openrouter' ? legacy.model : undefined),
                baseUrl: config.openrouter?.baseUrl || legacyValues.openrouterBaseUrl || 'https://openrouter.ai/api/v1',
                apiKey: secrets.openrouterApiKey
            },
            custom: {
                ...config.custom,
                model: config.custom?.model || (provider === 'custom' ? legacy.model : undefined),
                baseUrl: config.custom?.baseUrl || legacyValues.customBaseUrl,
                apiKey: secrets.customApiKey
            },
            bedrock: {
                ...config.bedrock,
                credentialMode: this.normalizeBedrockCredentialMode(config.bedrock?.credentialMode || legacy.bedrockCredentialMode),
                region: config.bedrock?.region || legacy.bedrockRegion,
                profile: config.bedrock?.profile || legacy.bedrockProfile,
                modelId: config.bedrock?.modelId || legacy.bedrockModelId,
                accessKeyId: secrets.bedrockAccessKeyId,
                secretAccessKey: secrets.bedrockSecretAccessKey,
                sessionToken: secrets.bedrockSessionToken
            }
        };
    }

    private getActiveProviderConfiguration(provider: AIProvider, providers: ICleanSlateProviderConfigurations): { model?: string; apiKey?: string } {
        switch (provider) {
            case 'cleanslate':
                return { model: providers.cleanslate?.model, apiKey: providers.cleanslate?.apiKey };
            case 'openai':
                return { model: providers.openai?.model, apiKey: providers.openai?.apiKey };
            case 'azureOpenAI':
                return { model: providers.azureOpenAI?.deploymentName, apiKey: providers.azureOpenAI?.apiKey };
            case 'anthropic':
                return { model: providers.anthropic?.model, apiKey: providers.anthropic?.apiKey };
            case 'gemini':
                return { model: providers.gemini?.model, apiKey: providers.gemini?.apiKey };
            case 'grok':
                return { model: providers.grok?.model, apiKey: providers.grok?.apiKey };
            case 'nvidia':
                return { model: providers.nvidia?.model, apiKey: providers.nvidia?.apiKey };
            case 'openrouter':
                return { model: providers.openrouter?.model, apiKey: providers.openrouter?.apiKey };
            case 'custom':
                return { model: providers.custom?.model, apiKey: providers.custom?.apiKey };
            case 'bedrock':
                return { model: providers.bedrock?.modelId, apiKey: providers.bedrock?.secretAccessKey };
        }
    }

    private normalizeProvider(provider: unknown): AIProvider {
        if (provider === 'cleanslate' || provider === 'openai' || provider === 'azureOpenAI' || provider === 'anthropic' || provider === 'gemini' || provider === 'grok' || provider === 'nvidia' || provider === 'openrouter' || provider === 'custom' || provider === 'bedrock') {
            return provider;
        }

        return 'openai';
    }

    private normalizeEmbeddingProvider(value: unknown, provider: AIProvider, providers: ICleanSlateProviderConfigurations): CleanSlateEmbeddingProvider {
        void provider;
        void providers;
        if (value === 'local' || value === 'openai' || value === 'azureOpenAI' || value === 'gemini') {
            return value;
        }
        return 'local';
    }

    private normalizeEmbeddingModel(provider: CleanSlateEmbeddingProvider, value: unknown): string {
        const model = typeof value === 'string' ? value.trim() : '';
        if (provider === 'local') {
            return model === 'Xenova/bge-small-en-v1.5' ? model : 'Xenova/bge-small-en-v1.5';
        }
        if (provider === 'gemini') {
            return model && model !== 'Xenova/bge-small-en-v1.5' ? model : 'gemini-embedding-001';
        }
        if (provider === 'azureOpenAI') {
            return model && model !== 'Xenova/bge-small-en-v1.5' ? model : 'text-embedding-3-small';
        }
        return model && model !== 'Xenova/bge-small-en-v1.5' ? model : 'text-embedding-3-small';
    }

    private normalizeBedrockCredentialMode(value: unknown): CleanSlateBedrockCredentialMode {
        return value === 'profile' || value === 'accessKey' || value === 'default' ? value : 'default';
    }

    private mergeStoredConfiguration(stored: StoredConfiguration, config: Partial<ICleanSlateConfiguration>): StoredConfiguration {
        const next: Record<string, any> = { ...stored };
        const updates: Record<string, any> = { ...config };
        const providerConfig = config.providers;
        for (const [key, value] of Object.entries(updates)) {
            if (key === 'providers') {
                continue;
            }
            if (CleanSlateConfigurationService.REMOVED_STORED_SETTINGS.has(key)) {
                delete next[key];
                continue;
            }
            if (this.isSecretFlatKey(key)) {
                continue;
            }
            if (value === undefined || value === null || value === '') {
                delete next[key];
            } else {
                next[key] = value;
            }
        }

        if (providerConfig) {
            const providers = { ...(stored.providers || {}) } as Record<string, any>;
            for (const [provider, value] of Object.entries(providerConfig)) {
                const sanitized = this.stripProviderSecrets(provider, value || {});
                providers[provider] = this.cleanObject({ ...(providers[provider] || {}), ...sanitized });
                if (!Object.keys(providers[provider]).length) {
                    delete providers[provider];
                }
            }
            next.providers = providers;
        }

        return this.cleanObject(this.stripRemovedStoredSettings(next)) as StoredConfiguration;
    }

    private stripProviderSecrets(provider: string, value: Record<string, any>): Record<string, any> {
        const next = this.trimProviderStringValues({ ...value });
        if (provider === 'cleanslate' || provider === 'openai' || provider === 'anthropic' || provider === 'gemini' || provider === 'grok' || provider === 'nvidia' || provider === 'openrouter' || provider === 'custom' || provider === 'azureOpenAI') {
            delete next.apiKey;
        }
        if (provider === 'bedrock') {
            delete next.accessKeyId;
            delete next.secretAccessKey;
            delete next.sessionToken;
        }
        return next;
    }

    private trimProviderStringValues(value: Record<string, any>): Record<string, any> {
        for (const key of Object.keys(value)) {
            if (typeof value[key] === 'string') {
                value[key] = value[key].trim();
            }
        }
        return value;
    }

    private isSecretFlatKey(key: string): boolean {
        return key === 'apiKey'
            || key === 'openaiApiKey'
            || key === 'azureOpenAIApiKey'
            || key === 'anthropicApiKey'
            || key === 'googleApiKey'
            || key === 'grokApiKey'
            || key === 'nvidiaApiKey'
            || key === 'openrouterApiKey'
            || key === 'customApiKey'
            || key === 'bedrockAccessKeyId'
            || key === 'bedrockSecretAccessKey'
            || key === 'bedrockSessionToken';
    }

    private cleanObject<T extends Record<string, any>>(value: T): T {
        for (const key of Object.keys(value)) {
            const item = value[key];
            if (item === undefined || item === null || item === '') {
                delete value[key];
            } else if (typeof item === 'object' && !Array.isArray(item)) {
                this.cleanObject(item);
                if (!Object.keys(item).length) {
                    delete value[key];
                }
            }
        }
        return value;
    }

    private async writeSecretUpdates(config: Partial<ICleanSlateConfiguration>): Promise<void> {
        await this.writeSecretFromValue('openaiApiKey', config.openaiApiKey || config.apiKey);
        await this.writeSecretFromValue('azureOpenAIApiKey', config.azureOpenAIApiKey);
        await this.writeSecretFromValue('anthropicApiKey', config.anthropicApiKey);
        await this.writeSecretFromValue('googleApiKey', config.googleApiKey);
        await this.writeSecretFromValue('grokApiKey', config.grokApiKey);
        await this.writeSecretFromValue('nvidiaApiKey', config.nvidiaApiKey);
        await this.writeSecretFromValue('openrouterApiKey', config.openrouterApiKey);
        await this.writeSecretFromValue('customApiKey', config.customApiKey);
        await this.writeSecretFromValue('bedrockAccessKeyId', config.bedrockAccessKeyId);
        await this.writeSecretFromValue('bedrockSecretAccessKey', config.bedrockSecretAccessKey);
        await this.writeSecretFromValue('bedrockSessionToken', config.bedrockSessionToken);

        const providers = config.providers;
        if (providers?.openai && 'apiKey' in providers.openai) {
            await this.writeSecretFromValue('openaiApiKey', providers.openai.apiKey);
        }
        if (providers?.azureOpenAI && 'apiKey' in providers.azureOpenAI) {
            await this.writeSecretFromValue('azureOpenAIApiKey', providers.azureOpenAI.apiKey);
        }
        if (providers?.anthropic && 'apiKey' in providers.anthropic) {
            await this.writeSecretFromValue('anthropicApiKey', providers.anthropic.apiKey);
        }
        if (providers?.gemini && 'apiKey' in providers.gemini) {
            await this.writeSecretFromValue('googleApiKey', providers.gemini.apiKey);
        }
        if (providers?.grok && 'apiKey' in providers.grok) {
            await this.writeSecretFromValue('grokApiKey', providers.grok.apiKey);
        }
        if (providers?.nvidia && 'apiKey' in providers.nvidia) {
            await this.writeSecretFromValue('nvidiaApiKey', providers.nvidia.apiKey);
        }
        if (providers?.openrouter && 'apiKey' in providers.openrouter) {
            await this.writeSecretFromValue('openrouterApiKey', providers.openrouter.apiKey);
        }
        if (providers?.custom && 'apiKey' in providers.custom) {
            await this.writeSecretFromValue('customApiKey', providers.custom.apiKey);
        }
        if (providers?.bedrock && 'accessKeyId' in providers.bedrock) {
            await this.writeSecretFromValue('bedrockAccessKeyId', providers.bedrock.accessKeyId);
        }
        if (providers?.bedrock && 'secretAccessKey' in providers.bedrock) {
            await this.writeSecretFromValue('bedrockSecretAccessKey', providers.bedrock.secretAccessKey);
        }
        if (providers?.bedrock && 'sessionToken' in providers.bedrock) {
            await this.writeSecretFromValue('bedrockSessionToken', providers.bedrock.sessionToken);
        }
    }

    private async writeSecretFromValue(key: keyof typeof SECRET_KEYS, value: unknown): Promise<void> {
        if (value === undefined) {
            return;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            await this.secretStorageService.delete(SECRET_KEYS[key]);
            delete this.secretCache[key];
            return;
        }

        await this.secretStorageService.set(SECRET_KEYS[key], value.trim());
        this.secretCache[key] = value.trim();
    }

    private async ensureSecretsLoaded(): Promise<void> {
        if (!this.secretsLoadPromise) {
            this.secretsLoadPromise = this.loadSecrets();
        }
        await this.secretsLoadPromise;
    }

    private async loadSecrets(): Promise<void> {
        const snapshot: ISecretSnapshot = {};
        for (const [cacheKey, secretKey] of Object.entries(SECRET_KEYS) as Array<[keyof ISecretSnapshot, string]>) {
            const value = await this.secretStorageService.get(secretKey);
            if (value) {
                snapshot[cacheKey] = value;
            }
        }
        this.secretCache = snapshot;
    }

    private readStoredConfiguration(): StoredConfiguration {
        const current = this.storageService.get(CleanSlateConfigurationService.CONFIG_STORAGE_KEY, StorageScope.PROFILE);
        const legacy = this.storageService.get(CleanSlateConfigurationService.LEGACY_CONFIG_STORAGE_KEY, StorageScope.PROFILE);
        const value = current || legacy;
        if (!value) {
            return {};
        }

        try {
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {};
            }
            const sanitized = this.stripRemovedStoredSettings({ ...parsed });
            if ((current || legacy) && JSON.stringify(sanitized) !== JSON.stringify(parsed)) {
                this.storageService.store(
                    CleanSlateConfigurationService.CONFIG_STORAGE_KEY,
                    JSON.stringify(sanitized),
                    StorageScope.PROFILE,
                    StorageTarget.USER
                );
            }
            return sanitized as StoredConfiguration;
        } catch (error) {
            this.logger.warn(`Failed to parse CleanSlate stored configuration: ${String(error)}`);
            return {};
        }
    }

    private async migrateLegacySettingsConfiguration(): Promise<void> {
        const alreadyMigrated = this.storageService.getBoolean(CleanSlateConfigurationService.MIGRATION_STORAGE_KEY, StorageScope.PROFILE, false);
        if (alreadyMigrated) {
            return;
        }

        const legacyConfig = this.configurationService.getValue<Record<string, any>>('cleanSlate') || {};
        const legacyKeys = Object.keys(legacyConfig).filter(key => legacyConfig[key] !== undefined);
        if (legacyKeys.length > 0) {
            const stored = this.readStoredConfiguration();
            const migrated = this.migrateLegacyConfigToProviders(legacyConfig, stored);
            this.storageService.store(
                CleanSlateConfigurationService.CONFIG_STORAGE_KEY,
                JSON.stringify(migrated),
                StorageScope.PROFILE,
                StorageTarget.USER
            );
            await this.migrateLegacySecrets(legacyConfig);
            void this.removeLegacySettingsValues(legacyKeys);
        }

        this.storageService.store(
            CleanSlateConfigurationService.MIGRATION_STORAGE_KEY,
            true,
            StorageScope.PROFILE,
            StorageTarget.USER
        );
    }

    private migrateLegacyConfigToProviders(legacyConfig: Record<string, any>, stored: StoredConfiguration): StoredConfiguration {
        const legacyProvider = this.normalizeProvider(legacyConfig.provider);
        const isAzure = this.isAzureEndpoint(legacyConfig.baseUrl || legacyConfig.openaiBaseUrl || legacyConfig.azureOpenAIApiBaseUrl || legacyConfig.azureBaseUrl || legacyConfig.azureEndpoint);
        const provider: AIProvider = isAzure ? 'azureOpenAI' : legacyProvider;
        const providers: Record<string, any> = { ...(stored.providers || {}) };

        if (isAzure) {
            providers.azureOpenAI = this.cleanObject({
                ...(providers.azureOpenAI || {}),
                endpoint: legacyConfig.baseUrl || legacyConfig.azureOpenAIApiBaseUrl || legacyConfig.azureBaseUrl || legacyConfig.azureEndpoint,
                deploymentName: legacyConfig.model,
                apiVersion: legacyConfig.azureOpenAIApiVersion || '2024-12-01-preview',
                embeddingDeploymentName: legacyConfig.embeddingModel
            });
        } else if (legacyProvider === 'openai') {
            providers.openai = this.cleanObject({
                ...(providers.openai || {}),
                model: legacyConfig.model,
                baseUrl: legacyConfig.openaiBaseUrl || legacyConfig.baseUrl
            });
        } else if (legacyProvider === 'anthropic') {
            providers.anthropic = this.cleanObject({ ...(providers.anthropic || {}), model: legacyConfig.model });
        } else if (legacyProvider === 'gemini') {
            providers.gemini = this.cleanObject({ ...(providers.gemini || {}), model: legacyConfig.model });
        } else if (legacyProvider === 'grok') {
            providers.grok = this.cleanObject({
                ...(providers.grok || {}),
                model: legacyConfig.model,
                baseUrl: legacyConfig.grokBaseUrl || legacyConfig.baseUrl || 'https://api.x.ai/v1'
            });
        } else if (legacyProvider === 'openrouter') {
            providers.openrouter = this.cleanObject({
                ...(providers.openrouter || {}),
                model: legacyConfig.model,
                baseUrl: legacyConfig.openrouterBaseUrl || legacyConfig.baseUrl || 'https://openrouter.ai/api/v1'
            });
        } else if (legacyProvider === 'custom') {
            providers.custom = this.cleanObject({
                ...(providers.custom || {}),
                model: legacyConfig.model,
                baseUrl: legacyConfig.customBaseUrl || legacyConfig.baseUrl
            });
        }

        return this.cleanObject(this.stripRemovedStoredSettings({
            ...legacyConfig,
            ...stored,
            provider,
            providers,
            model: undefined,
            apiKey: undefined,
            openaiApiKey: undefined,
            azureOpenAIApiKey: undefined,
            anthropicApiKey: undefined,
            googleApiKey: undefined,
            grokApiKey: undefined,
            nvidiaApiKey: undefined,
            openrouterApiKey: undefined,
            customApiKey: undefined
        })) as StoredConfiguration;
    }

    private stripRemovedStoredSettings<T extends Record<string, any>>(value: T): T {
        for (const key of CleanSlateConfigurationService.REMOVED_STORED_SETTINGS) {
            delete value[key];
        }
        return value;
    }

    private async migrateLegacySecrets(legacyConfig: Record<string, any>): Promise<void> {
        const isAzure = this.isAzureEndpoint(legacyConfig.baseUrl || legacyConfig.openaiBaseUrl || legacyConfig.azureOpenAIApiBaseUrl || legacyConfig.azureBaseUrl || legacyConfig.azureEndpoint);
        await this.writeSecretFromValue(isAzure ? 'azureOpenAIApiKey' : 'openaiApiKey', legacyConfig.openaiApiKey || legacyConfig.azureOpenAIApiKey || legacyConfig.azureApiKey || legacyConfig.apiKey);
        await this.writeSecretFromValue('anthropicApiKey', legacyConfig.anthropicApiKey);
        await this.writeSecretFromValue('googleApiKey', legacyConfig.googleApiKey);
        await this.writeSecretFromValue('grokApiKey', legacyConfig.grokApiKey);
        await this.writeSecretFromValue('nvidiaApiKey', legacyConfig.nvidiaApiKey);
        await this.writeSecretFromValue('openrouterApiKey', legacyConfig.openrouterApiKey);
        await this.writeSecretFromValue('customApiKey', legacyConfig.customApiKey);
    }

    private async removeLegacySettingsValues(keys: string[]): Promise<void> {
        for (const key of keys) {
            try {
                await this.configurationService.updateValue(`cleanSlate.${key}`, undefined, ConfigurationTarget.USER);
            } catch (error) {
                this.logger.warn(`Failed to remove legacy CleanSlate setting cleanSlate.${key}: ${String(error)}`);
            }
        }
    }

    private isAzureEndpoint(value: unknown): boolean {
        const endpoint = typeof value === 'string' ? value.toLowerCase() : '';
        return endpoint.includes('openai.azure.com')
            || endpoint.includes('cognitiveservices.azure.com')
            || endpoint.includes('.services.ai.azure.com')
            || endpoint.includes('/openai/v1');
    }

    private getOpenAICompatibleFlavor(
        provider: AIProvider,
        providers: ICleanSlateProviderConfigurations
    ): CleanSlateOpenAICompatibleProviderFlavor | undefined {
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
                return this.isAzureFoundryEndpoint(providers.azureOpenAI?.endpoint)
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
