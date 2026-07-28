/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { Event } from '../core/event.js';
import { IHeaders, IRequestOptions } from '../host/services.js';
import { CancellationToken } from '../core/cancellation.js';
import { VSBuffer } from '../core/buffer.js';


export type AIProvider =
    | 'cleanslate'
    | 'openai'
    | 'azureOpenAI'
    | 'anthropic'
    | 'gemini'
    | 'grok'
    | 'nvidia'
    | 'openrouter'
    | 'custom'
    | 'bedrock';
export type CleanSlateEmbeddingProvider = 'local' | 'openai' | 'azureOpenAI' | 'gemini';
export type CleanSlateExecutionFlow = 'normal' | 'planning';
export type CleanSlateReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const CLEANSLATE_REASONING_LEVELS: readonly CleanSlateReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function formatCleanSlateReasoningLevel(level: CleanSlateReasoningLevel): string {
    switch (level) {
        case 'none': return 'None';
        case 'minimal': return 'Minimal';
        case 'low': return 'Low';
        case 'medium': return 'Medium';
        case 'high': return 'High';
        case 'xhigh': return 'Extra High';
        case 'max': return 'Max';
    }
}

export function isCleanSlateReasoningLevel(value: unknown): value is CleanSlateReasoningLevel {
    return typeof value === 'string' && (CLEANSLATE_REASONING_LEVELS as readonly string[]).includes(value);
}

export interface ICleanSlateExecutionState {
    readonly planMode: boolean;
    readonly reasoningLevel: CleanSlateReasoningLevel;
}

export function normalizeCleanSlateExecutionState(value: {
    readonly planMode?: unknown;
    readonly reasoningLevel?: unknown;
} = {}): ICleanSlateExecutionState {
    const planMode = typeof value.planMode === 'boolean'
        ? value.planMode
        : false;
    const reasoningLevel = isCleanSlateReasoningLevel(value.reasoningLevel)
        ? value.reasoningLevel
        : 'low';

    return {
        planMode,
        reasoningLevel
    };
}

export const CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS = 64_000;

export interface ICleanSlateManagedProviderConfiguration {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface ICleanSlateOpenAIProviderConfiguration {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface ICleanSlateAzureOpenAIProviderConfiguration {
    endpoint?: string;
    deploymentName?: string;
    apiVersion?: string;
    embeddingDeploymentName?: string;
    apiKey?: string;
}

export interface ICleanSlateAnthropicProviderConfiguration {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface ICleanSlateGeminiProviderConfiguration {
    model?: string;
    apiKey?: string;
}

export interface ICleanSlateGrokProviderConfiguration {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface ICleanSlateNvidiaProviderConfiguration {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface ICleanSlateOpenRouterProviderConfiguration {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface ICleanSlateCustomProviderConfiguration {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
}

export type CleanSlateBedrockCredentialMode = 'default' | 'profile' | 'accessKey';

export interface ICleanSlateBedrockProviderConfiguration {
    modelId?: string;
    region?: string;
    credentialMode?: CleanSlateBedrockCredentialMode;
    profile?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
}

export interface ICleanSlateProviderConfigurations {
    cleanslate?: ICleanSlateManagedProviderConfiguration;
    openai?: ICleanSlateOpenAIProviderConfiguration;
    azureOpenAI?: ICleanSlateAzureOpenAIProviderConfiguration;
    anthropic?: ICleanSlateAnthropicProviderConfiguration;
    gemini?: ICleanSlateGeminiProviderConfiguration;
    grok?: ICleanSlateGrokProviderConfiguration;
    nvidia?: ICleanSlateNvidiaProviderConfiguration;
    openrouter?: ICleanSlateOpenRouterProviderConfiguration;
    custom?: ICleanSlateCustomProviderConfiguration;
    bedrock?: ICleanSlateBedrockProviderConfiguration;
}

export type CleanSlateWebSearchProvider =
    | 'searxng'
    | 'exaMcpAnonymous'
    | 'parallelMcpAnonymous';

export type CleanSlateWebSearchMode = 'freeOnly';

export interface ICleanSlateWebSearchConfiguration {
    enabled?: boolean;
    mode?: CleanSlateWebSearchMode;
    providerOrder?: CleanSlateWebSearchProvider[];
    searxngBaseUrl?: string;
    includeAnonymousHostedProviders?: boolean;
    hardStopOnQuota?: boolean;
    maxResults?: number;
    timeoutMs?: number;
}

export interface ICleanSlateWebDomainFilters {
    allowed?: string[];
    blocked?: string[];
}

export interface ICleanSlateWebSearchOptions {
    query: string;
    maxResults?: number;
    providerOrder?: CleanSlateWebSearchProvider[];
    searxngBaseUrl?: string;
    includeAnonymousHostedProviders?: boolean;
    hardStopOnQuota?: boolean;
    timeoutMs?: number;
    sessionId?: string;
    modelName?: string;
    domains?: ICleanSlateWebDomainFilters;
    recencyDays?: number;
}

export interface ICleanSlateWebCitation {
    url: string;
    title?: string;
    source?: string;
}

export interface ICleanSlateWebSearchResult {
    title: string;
    url: string;
    snippet?: string;
    publishedDate?: string;
    source?: string;
    provider: CleanSlateWebSearchProvider;
    score?: number;
}

export interface ICleanSlateWebProviderAttempt {
    provider: CleanSlateWebSearchProvider;
    status: 'skipped' | 'success' | 'failed';
    reason?: string;
    durationMs?: number;
}

export interface ICleanSlateWebSearchResponse {
    success: boolean;
    query: string;
    provider?: CleanSlateWebSearchProvider;
    results: ICleanSlateWebSearchResult[];
    citations: ICleanSlateWebCitation[];
    attempts: ICleanSlateWebProviderAttempt[];
    rawContent?: string;
    error?: string;
}

export type CleanSlateWebFetchFormat = 'markdown' | 'text' | 'html';

export interface ICleanSlateWebFetchOptions {
    url: string;
    format?: CleanSlateWebFetchFormat;
    timeoutMs?: number;
    maxBytes?: number;
    maxContentCharacters?: number;
    allowPlainHttp?: boolean;
}

export interface ICleanSlateWebFetchResponse {
    success: boolean;
    url: string;
    finalUrl?: string;
    format: CleanSlateWebFetchFormat;
    title?: string;
    contentType?: string;
    content?: string;
    bytes?: number;
    truncated?: boolean;
    citations: ICleanSlateWebCitation[];
    redirectUrl?: string;
    error?: string;
    code?: string;
}

export interface ICleanSlateLocalEmbeddingOptions {
    model: string;
    texts: string[];
    maxTokens?: number;
}

export interface ICleanSlateLocalEmbeddingResponse {
    model: string;
    dimensions: number;
    embeddings: number[][];
}

export interface ICleanSlatePersistedThreadMessage {
    readonly role: string;
    readonly content: string;
    readonly isInternalState?: boolean;
    readonly renderPayload?: string;
    readonly images?: string[];
    readonly id?: string;
}

/**
 * Durable model-facing conversation state. This is deliberately separate from
 * the renderer transcript: assistant tool calls and tool results are runtime
 * protocol messages, not user-visible chat rows.
 */
export interface ICleanSlateAgentRuntimeSnapshot {
    readonly version: 1;
    readonly messages: IChatMessage[];
    readonly objective?: string;
    readonly mode?: string;
    readonly phase?: string;
    readonly pendingInteraction?: ICleanSlatePendingAgentInteraction;
}

export interface ICleanSlatePendingAgentInteraction {
    readonly kind: 'question';
    readonly toolCallId: string;
    readonly toolName: 'ask_question';
    readonly question: unknown;
    readonly objective?: string;
    readonly mode?: string;
    readonly phase?: string;
}

export interface ICleanSlatePersistedSession {
    readonly id: string;
    readonly parentSessionId?: string;
    readonly createdAt?: number;
    readonly title: string;
    readonly savedAt: number;
    readonly updatedAt?: number;
    readonly workspaceId?: string;
    readonly projectRoot?: string;
    readonly workDir?: string;
    readonly status?: 'starting' | 'running' | 'detached' | 'stopping' | 'stopped';
    readonly isGenerating?: boolean;
    readonly sessionKey?: string;
    readonly workspaceName?: string;
    readonly planMode?: boolean;
    readonly reasoningLevel?: CleanSlateReasoningLevel;
    readonly history: ICleanSlatePersistedThreadMessage[];
    readonly transcript?: ICleanSlatePersistedThreadMessage[];
    readonly transcriptVersion?: number;
    readonly taskState?: unknown;
    readonly threadState?: unknown;
    readonly agentRuntimeState?: ICleanSlateAgentRuntimeSnapshot;
    readonly agent?: unknown;
}

export interface ICleanSlateThreadSessionUpdate {
    readonly originId: string;
    readonly session: ICleanSlatePersistedSession;
    readonly makeActive?: boolean;
}

export interface ICleanSlateConfiguration {
    provider: AIProvider;
    providers?: ICleanSlateProviderConfigurations;
    model?: string;
    embeddingProvider?: CleanSlateEmbeddingProvider;
    embeddingModel?: string;
    apiKey?: string; // OpenAI/Anthropic/Generic
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string; // Specific for Gemini
    baseUrl?: string;
    azureOpenAIApiKey?: string;
    azureOpenAIEndpoint?: string;
    azureOpenAIApiVersion?: string;
    azureOpenAIDeploymentName?: string;
    azureOpenAIEmbeddingDeploymentName?: string;
    grokApiKey?: string;
    grokBaseUrl?: string;
    nvidiaApiKey?: string;
    nvidiaBaseUrl?: string;
    openrouterApiKey?: string;
    openrouterBaseUrl?: string;
    customApiKey?: string;
    customBaseUrl?: string;
    bedrockRegion?: string;
    bedrockCredentialMode?: CleanSlateBedrockCredentialMode;
    bedrockProfile?: string;
    bedrockAccessKeyId?: string;
    bedrockSecretAccessKey?: string;
    bedrockSessionToken?: string;
    bedrockModelId?: string;
    ragEnabled?: boolean;
    webSearch?: ICleanSlateWebSearchConfiguration;
    mcpServers?: Array<string | MCPServerConfiguration>;
    /**
     * Resolved usable input budget used by the prompt budgeter. Browser configuration
     * derives this from provider/model capabilities rather than exposing a manual setting.
     */
    contextWindow?: number;
    /**
     * Active model's advertised context window, when known.
     */
    modelContextWindow?: number;
    /**
     * Active model's advertised output limit, when known.
     */
    modelMaxOutputTokens?: number;
    /**
     * Active model's prompt/input budget before CleanSlate reserves room for output and overhead.
     */
    maxInputTokens?: number;
    /**
     * Tokens held back from maxInputTokens before automatic compaction is considered.
     */
    autoCompactReserveTokens?: number;
    /**
     * Legacy manual output cap. Browser configuration ignores stored values and uses
     * execution-profile defaults.
     */
    maxOutputTokens?: number;
    /**
     * Resolved per-file prompt budget in characters.
     */
    fileTruncation?: number;
    /**
     * Enables the explicit planning flow for the active chat session.
     */
    planMode?: boolean;
    /**
     * Provider reasoning level applied independently from normal vs planning mode.
     */
    reasoningLevel?: CleanSlateReasoningLevel;
    /**
     * Optional maximum number of agentic model turns before the run pauses.
     * When omitted, the loop is bounded by its progress and doom-loop guards.
     */
    maxTurns?: number;
    /**
     * Number of no-tool turns tolerated in EXECUTION before stopping.
     */
    maxNoToolTurns?: number;
    /**
     * Retry budget for deterministic verification/fix loops during EXECUTION.
     */
    maxVerificationRetries?: number;
    /**
     * Optional non-interactive commands to run before concluding EXECUTION.
     * Example: ["npm run -s lint", "npm run -s test"].
     */
    verificationCommands?: string[];
    /**
     * If true, marker warnings are treated as blocking during deterministic verification.
     */
    failOnWarnings?: boolean;
    /**
     * Resolved total character budget for the dynamic truncation engine.
     */
    globalContextBudget?: number;
}

export interface MCPServerConfiguration {
    name?: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export interface ICleanSlateConfigurationService {
    _serviceBrand: undefined;
    readonly onDidChangeConfiguration: Event<ICleanSlateConfiguration>;
    getConfiguration(): ICleanSlateConfiguration;
    getResolvedConfiguration(): Promise<ICleanSlateConfiguration>;
    updateConfiguration(config: Partial<ICleanSlateConfiguration>): Promise<void>;
    refreshManagedToken(rejectedToken?: string): Promise<string>;
    getManagedEntitlements(): Promise<ICleanSlateManagedEntitlements>;
    getManagedAccount(): ICleanSlateManagedAccount | undefined;
}

export interface ICleanSlateManagedAccount {
    readonly name?: string;
    readonly email?: string;
    readonly profileImageUrl?: string;
    readonly provider?: string;
    readonly tokenType?: string;
    readonly expiresAt?: string;
    readonly expiresIn?: string;
    readonly signedInAt?: string;
}

export interface ICleanSlateManagedModel {
    readonly id: string;
    readonly name: string;
    /** Server-declared context window; authoritative over client-side family defaults. */
    readonly context_window_tokens?: number | null;
    readonly max_output_tokens?: number | null;
    /** Premium model usable only with usage credits. The server enforces this; the UI only reflects it. */
    readonly requires_credits?: boolean;
}

export interface ICleanSlateManagedEntitlements {
    /** Identity resolved from the bearer token by the CleanSlate API. */
    readonly account?: {
        readonly id?: number;
        readonly email?: string;
        readonly name?: string;
        readonly avatar_url?: string;
    };
    readonly plan?: { readonly id?: string; readonly name?: string; readonly price?: { readonly amount_cents?: number; readonly currency?: string; readonly interval?: string } };
    readonly managed_ai?: boolean;
    readonly can_use_managed_ai?: boolean;
    readonly managed_ai_reason?: string;
    readonly usage?: {
        readonly daily_requests?: number;
        readonly weekly_requests?: number;
        readonly requests?: number;
        readonly total_tokens?: number;
        readonly cost_cents?: number;
        readonly estimated_cost_micros?: number;
    };
    readonly limits?: {
        readonly daily_action_limit?: number;
        readonly weekly_action_limit?: number;
        readonly monthly_action_limit?: number;
        readonly monthly_budget_cents?: number;
        readonly monthly_budget_micros?: number;
        readonly monthly_token_limit?: number;
        readonly remaining_budget_cents?: number;
        readonly remaining_budget_micros?: number;
        readonly remaining_tokens?: number;
        readonly remaining_daily_actions?: number;
        readonly remaining_weekly_actions?: number;
        readonly remaining_monthly_actions?: number;
    };
    readonly resets_at?: { readonly daily?: string; readonly weekly?: string; readonly monthly?: string };
    readonly period?: { readonly start?: string; readonly end?: string };
    readonly credits?: { readonly balance_cents?: number };
    readonly models?: readonly ICleanSlateManagedModel[];
}

// --- Logger ---

export interface ICleanSlateLogger {
    _serviceBrand: undefined;
    info(message: string): void;
    warn(message: string): void;
    error(message: string | Error): void;
    debug(message: string): void;
    trace(message: string): void;
}

export const CLEANSLATE_INDEX_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
export const CLEANSLATE_ARTIFACT_SCHEME = 'cleanslate-artifact';

// --- Main AI Service ---

export interface IChatMessagePart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string; // The base64 data URI
    };
    cache_control?: { type: 'ephemeral' };
}

export interface IChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | IChatMessagePart[];
    toolCallId?: string;
    toolName?: string;
    toolCalls?: IToolCall[];
}

export interface IToolCall {
    id?: string;
    toolName: string;
    input: any;
    providerMetadata?: {
        gemini?: {
            thoughtSignature?: string;
        };
    };
}

export interface IChatToolDefinition {
    name: string;
    description: string;
    parametersSchema?: Record<string, any>;
}

export interface IChatOptions {
    tools?: IChatToolDefinition[];
    /** Renderer-local cancellation for the active model request. Never serialized to a provider. */
    cancellationToken?: CancellationToken;
    /**
     * Stable conversation/session key used by providers that expose prompt cache
     * affinity controls. Callers can omit this when no durable session id exists.
     */
    sessionId?: string;
    /**
     * Force the provider to return a native tool call for this tool name when
     * the provider supports tool choice. Used for deterministic agent handoffs.
     */
    requiredToolName?: string;
    /**
     * Upper bound used by internal auxiliary requests such as conversation
     * compaction. It is never sent as a provider option directly; the service
     * folds it into the provider's request output cap.
     */
    maxOutputTokens?: number;
}

export interface ICleanSlateBedrockListModelsOptions {
    region: string;
    credentialMode?: CleanSlateBedrockCredentialMode;
    profile?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
}

export interface ICleanSlateBedrockConverseStreamOptions extends ICleanSlateBedrockListModelsOptions {
    modelId: string;
    messages: IChatMessage[];
    options?: IChatOptions;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    additionalModelRequestFields?: Record<string, any>;
}

export interface ICleanSlateOpenAICompatibleListModelsOptions {
    apiKey?: string;
    baseUrl?: string;
    providerName?: string;
}

export interface ICleanSlateOpenAICompatibleChatOptions extends ICleanSlateOpenAICompatibleListModelsOptions {
    providerName: string;
    model: string;
    messages: IChatMessage[];
    options?: IChatOptions;
    maxOutputTokens?: number;
    useMaxCompletionTokens?: boolean;
    includeSamplingParameters?: boolean;
    temperature?: number;
    topP?: number;
    topK?: number;
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    reasoningSummary?: 'auto';
    parallelToolCalls?: boolean;
    store?: boolean;
    promptCacheKey?: string;
    include?: string[];
    bodyOptions?: Record<string, any>;
    azure?: {
        endpoint: string;
        deploymentName: string;
        apiVersion?: string;
    };
    suppressReasoningContent?: boolean;
}

export type ICleanSlateOpenAIResponsesOptions = ICleanSlateOpenAICompatibleChatOptions;

export interface ICleanSlateAnthropicListModelsOptions {
    apiKey: string;
    baseUrl?: string;
}

export interface ICleanSlateAnthropicMessagesOptions extends ICleanSlateAnthropicListModelsOptions {
    model: string;
    messages: IChatMessage[];
    options?: IChatOptions;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    thinking?: Record<string, any>;
}

export interface ICleanSlateGeminiListModelsOptions {
    apiKey: string;
}

export interface ICleanSlateGeminiGenerateContentOptions extends ICleanSlateGeminiListModelsOptions {
    model: string;
    messages: IChatMessage[];
    options?: IChatOptions;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    thinkingConfig?: Record<string, any>;
}

export interface ICleanSlateTransportStatus {
    state: 'retrying' | 'recovered';
    attempt: number;
    maxAttempts: number;
    delayMs?: number;
    message?: string;
}

export type CleanSlateResponsePart =
    | { type: 'text'; content: string; phase?: 'commentary' | 'final_answer' }
    | { type: 'reasoning'; content: string }
    | { type: 'tool_call'; call: IToolCall }
    | { type: 'transport_status'; status: ICleanSlateTransportStatus };

export interface ICleanSlateProviderCapabilities {
    provider: AIProvider;
    nativeToolCalls: boolean;
    degradedReason?: string;
}

export interface ICleanSlateService {
    _serviceBrand: undefined;
    generate(prompt: string): Promise<AsyncIterable<CleanSlateResponsePart>>;
    chat(messages: IChatMessage[], options?: IChatOptions): Promise<AsyncIterable<CleanSlateResponsePart>>;
    getModels(provider?: AIProvider): Promise<string[]>;
    getProviderCapabilities(provider?: AIProvider): ICleanSlateProviderCapabilities;
}

// --- Embedding Service ---

export interface ICleanSlateEmbeddingService {
    _serviceBrand: undefined;
    getEmbeddingProfile(): Promise<string>;
    getEmbedding(text: string): Promise<number[]>;
    getEmbeddings(texts: string[]): Promise<number[][]>;
}

// --- Index Service ---

export interface ISearchResult {
    uri: URI;
    content: string;
    score: number;
    range?: { startLineNumber: number; endLineNumber: number };
}

export interface ICleanSlateIndexService {
    _serviceBrand: undefined;
    readonly onDidStatusChange: Event<boolean>;
    readonly isIndexing: boolean;
    indexWorkspace(): Promise<void>;
    search(query: string, limit?: number, threshold?: number): Promise<ISearchResult[]>;
}

// --- Vector Store ---

export interface IVectorEntry {
    uri: string;
    content: string;
    embedding: number[];
    hash?: string;
    profile?: string;
    metadata?: any;
}

export interface IVectorSearchResult {
    uri: string;
    content: string;
    score: number;
    metadata?: any;
}

export interface ICleanSlateVectorStore {
    _serviceBrand: undefined;
    save(entries: IVectorEntry[]): Promise<void>;
    load(): Promise<IVectorEntry[]>;
    search(queryEmbedding: number[], limit?: number, threshold?: number, profile?: string): Promise<IVectorSearchResult[]>;
    clear(): Promise<void>;
    getHash(uri: string, profile?: string): Promise<string | undefined>;
    deleteByUri(uri: string, profile?: string): Promise<void>;
    getQueryEmbedding(query: string, profile?: string): Promise<number[] | undefined>;
    saveQueryEmbedding(query: string, embedding: number[], profile?: string): Promise<void>;
}

// --- Context Service ---

export interface ICleanSlateContext {
    readonly activeFile?: {
        readonly uri: URI;
        /**
         * Legacy content field. Browser context providers may leave this empty so
         * prompt construction can inject skeletons instead of full files.
         */
        readonly content: string;
        readonly selection: string;
        readonly cursorLine: number;
        readonly languageId: string;
    };
    readonly openFiles: {
        readonly uri: URI;
        readonly languageId: string;
    }[];
}

export interface ICleanSlateContextService {
    _serviceBrand: undefined;
    getContext(): Promise<ICleanSlateContext>;
}

// --- Edit Code Service ---

export interface ICleanSlateEditCodeService {
    _serviceBrand: undefined;
    readonly onDidPendingEditsChange: Event<void>;
    undoLastAIEdit(uri: URI): void;
    acceptAll(): void;
    rejectAll(): void;
    hasPendingEdits(): boolean;
    getPendingEditsCount(): number;
    getPendingEditsInfo(): { uri: URI; added: number; deleted: number }[];
    getPendingEditsDiffs(): { uri: URI; added: number; deleted: number; diff: string; beforeContent: string; afterContent: string }[];
}

// --- MCP Client Service ---

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: any;
    serverName?: string;
    originalName?: string;
	readOnlyHint?: boolean;
	openWorldHint?: boolean;
}

export interface IMCPClientService {
    _serviceBrand: undefined;
    getTools(token?: CancellationToken): Promise<MCPTool[]>;
    executeTool(toolName: string, input: any, token?: CancellationToken): Promise<any>;
    refreshServers(token?: CancellationToken): Promise<void>;
}
// --- Artifact Service ---

export interface IArtifact {
    id: string;
    type: string; // e.g., 'implementation_plan'
    content: string;
    timestamp: number;
    metadata?: any;
}

export interface ICleanSlateArtifactLookupOptions {
    sessionId?: string;
}

export interface ICleanSlateArtifactService {
    _serviceBrand: undefined;
    readonly onDidArtifactChange: Event<IArtifact>;
    createArtifact(type: string, content: string, metadata?: any): IArtifact;
    saveArtifact(type: string, content: string, metadata?: any): IArtifact;
    getArtifact(id: string): IArtifact | undefined;
    getArtifactsByType(type: string, options?: ICleanSlateArtifactLookupOptions): IArtifact[];
    getLatestArtifactByType(type: string, options?: ICleanSlateArtifactLookupOptions): IArtifact | undefined;
    deleteArtifact(id: string): void;
    clear(): void;
}

export interface ICleanSlateBufferedRequestResponse {
    res: {
        statusCode?: number;
        headers: IHeaders;
    };
    data: string;
}

export interface ICleanSlateCommandExecutionOptions {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    sessionId?: string;
    workspaceId?: string;
}

export interface ICleanSlateCommandExecutionResult {
    success: boolean;
    command: string;
    cwd?: string;
    sessionId?: string;
    workspaceId?: string;
    processId?: string;
    pid?: number;
    status?: 'completed' | 'ready' | 'running' | 'exited' | 'failed' | 'timeout';
    exitCode?: number;
    signal?: string;
    stdout: string;
    stderr: string;
    output: string;
    durationMs: number;
    timedOut: boolean;
    promotedToBackground?: boolean;
    url?: string;
    error?: string;
}

export type CleanSlateCommandOutputStream = 'stdout' | 'stderr';

export type ICleanSlateCommandOutputEvent =
    | {
        type: 'started';
        command: string;
        cwd?: string;
        pid?: number;
        startedAt: number;
    }
    | {
        type: CleanSlateCommandOutputStream;
        command: string;
        cwd?: string;
        pid?: number;
        chunk: string;
        stdout: string;
        stderr: string;
        output: string;
        durationMs: number;
    }
    | {
        type: 'status';
        command: string;
        cwd?: string;
        pid?: number;
        status: 'running' | 'ready' | 'timeout' | 'failed';
        message?: string;
        durationMs: number;
    }
    | {
        type: 'result';
        result: ICleanSlateCommandExecutionResult;
    }
    | {
        type: 'error';
        command?: string;
        cwd?: string;
        error: string;
    };

export interface ICleanSlateBackgroundCommandOptions extends ICleanSlateCommandExecutionOptions {
    readyPattern?: string;
    startupTimeoutMs?: number;
}

export interface ICleanSlateBackgroundCommandResult {
    success: boolean;
    processId?: string;
    pid?: number;
    command: string;
    cwd?: string;
    sessionId?: string;
    workspaceId?: string;
    status: 'ready' | 'running' | 'exited' | 'failed' | 'timeout';
    exitCode?: number;
    signal?: string;
    stdout: string;
    stderr: string;
    output: string;
    durationMs: number;
    url?: string;
    error?: string;
}

export interface ICleanSlateStopBackgroundCommandResult {
    success: boolean;
    processId: string;
    stopped: boolean;
    message?: string;
    error?: string;
}

export type CleanSlatePlaywrightBrowserAction =
    | 'evaluate'
    | 'resolvePoint'
    | 'click'
    | 'hover'
    | 'fill'
    | 'check'
    | 'select'
    | 'upload'
    | 'type'
    | 'press'
    | 'scroll'
    | 'wait'
    | 'screenshot';

export interface ICleanSlatePlaywrightBrowserRequest {
    viewId: string;
    action: CleanSlatePlaywrightBrowserAction;
    input?: Record<string, unknown>;
}

export interface ICleanSlateModelsDevModelMetadata {
    id: string;
    provider: string;
    releaseDate?: string;
    reasoning?: boolean;
    reasoningEfforts?: Array<'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
    toolCall?: boolean;
    structuredOutput?: boolean;
    temperature?: boolean;
    contextWindowTokens?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    inputCostPer1MTokens?: number;
    outputCostPer1MTokens?: number;
    cacheReadCostPer1MTokens?: number;
    cacheWriteCostPer1MTokens?: number;
}

export interface ICleanSlateRuntimeConfig {
    readonly authWebUrl: string;
    readonly apiBaseUrl: string;
    readonly managedAIBaseUrl: string;
    readonly proCheckoutUrl: string;
}

// --- Main Process Service (IPC Proxy) ---
export interface ICleanSlateMainService {
    readonly _serviceBrand: undefined;
    readonly onDidPublishThreadSession: Event<ICleanSlateThreadSessionUpdate>;

    getRuntimeConfig(): Promise<ICleanSlateRuntimeConfig>;

    /**
     * Perform a standard (buffered) request from the Node process to bypass CORS.
     */
    proxyRequest(options: IRequestOptions, token: CancellationToken): Promise<ICleanSlateBufferedRequestResponse>;

    /**
     * Perform a streaming request from the Node process.
     * Returns an Event that fires with chunks of data.
     * Fires `null` when the stream is finished.
     */
    proxyStream(options: IRequestOptions, token: CancellationToken): Event<VSBuffer | string | null>;

    /**
     * Resolve validated capability metadata from the cached models.dev catalog.
     * Returns undefined when the catalog is unavailable or has no exact match.
     */
    getModelsDevModelMetadata(provider: AIProvider, model: string, token: CancellationToken): Promise<ICleanSlateModelsDevModelMetadata | undefined>;

    /**
     * List models from an OpenAI-compatible provider using the provider SDK in Node.
     */
    listOpenAICompatibleModels(options: ICleanSlateOpenAICompatibleListModelsOptions, token: CancellationToken): Promise<string[]>;

    /**
     * Stream an OpenAI-compatible chat completion using the provider SDK in Node.
     */
    openAICompatibleChatStream(options: ICleanSlateOpenAICompatibleChatOptions, token: CancellationToken): Event<VSBuffer | string | null>;

    /**
     * Stream an OpenAI Responses API request using the provider SDK in Node.
     */
    openAIResponsesStream(options: ICleanSlateOpenAIResponsesOptions, token: CancellationToken): Event<VSBuffer | string | null>;

    /**
     * List Anthropic models using the Anthropic SDK in Node.
     */
    listAnthropicModels(options: ICleanSlateAnthropicListModelsOptions, token: CancellationToken): Promise<string[]>;

    /**
     * Stream an Anthropic Messages request using the Anthropic SDK in Node.
     */
    anthropicMessagesStream(options: ICleanSlateAnthropicMessagesOptions, token: CancellationToken): Event<VSBuffer | string | null>;

    /**
     * List Gemini models using the Google GenAI SDK in Node.
     */
    listGeminiModels(options: ICleanSlateGeminiListModelsOptions, token: CancellationToken): Promise<string[]>;

    /**
     * Stream a Gemini Generate Content request using the Google GenAI SDK in Node.
     */
    geminiGenerateContentStream(options: ICleanSlateGeminiGenerateContentOptions, token: CancellationToken): Event<VSBuffer | string | null>;

    /**
     * List AWS Bedrock foundation models using the production AWS credential chain.
     */
    listBedrockFoundationModels(options: ICleanSlateBedrockListModelsOptions, token: CancellationToken): Promise<string[]>;

    /**
     * Stream an AWS Bedrock Converse request from the Node process so AWS SDKs and credentials stay off the renderer.
     */
    bedrockConverseStream(options: ICleanSlateBedrockConverseStreamOptions, token: CancellationToken): Event<VSBuffer | string | null>;

    /**
     * Search the public web through configured free/search-provider adapters.
     */
    webSearch(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<ICleanSlateWebSearchResponse>;

    /**
     * Fetch and extract a public web URL from the Node process with SSRF, redirect, size, and timeout guards.
     */
    webFetch(options: ICleanSlateWebFetchOptions, token: CancellationToken): Promise<ICleanSlateWebFetchResponse>;

    /**
     * Generate embeddings with CleanSlate's bundled local embedding model.
     */
    localEmbeddings(options: ICleanSlateLocalEmbeddingOptions, token: CancellationToken): Promise<ICleanSlateLocalEmbeddingResponse>;

    /**
     * Execute a finite shell command in the main process and return the complete captured result.
     */
    executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult>;

    /**
     * Execute a finite shell command and stream bounded stdout/stderr snapshots while it runs.
     * Fires `null` after the final `result` event.
     */
    executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken): Event<ICleanSlateCommandOutputEvent | null>;

    /**
     * Start a long-running command such as a dev server and return once it is ready,
     * exits, or reaches the startup timeout.
     */
    startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult>;

    /**
     * Stop a background command started through startBackgroundCommand.
     */
    stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult>;

    /**
     * Read the latest status and captured logs for a managed background command.
     */
    getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult>;

    /**
     * List all managed background commands that are still retained by the session.
     */
    listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]>;

    /**
     * Run Playwright against the existing integrated BrowserView through CDP.
     * The implementation must not launch or mirror to a second browser.
     */
    browserPlaywright(request: ICleanSlatePlaywrightBrowserRequest): Promise<unknown>;

    loadThreadSession(sessionId: string): Promise<ICleanSlatePersistedSession | undefined>;
    loadActiveThreadSession(workspaceId: string): Promise<ICleanSlatePersistedSession | undefined>;
    saveActiveThreadSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void>;
    publishThreadSession(update: ICleanSlateThreadSessionUpdate): Promise<void>;
    clearActiveThreadSession(workspaceId: string): Promise<void>;
    listThreadSessions(): Promise<ICleanSlatePersistedSession[]>;
    listArchivedThreadSessions(workspaceId: string): Promise<ICleanSlatePersistedSession[]>;
    archiveThreadSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void>;
    removeThreadSession(sessionId: string): Promise<void>;
    removeArchivedThreadSession(workspaceId: string, sessionId: string): Promise<void>;
}

