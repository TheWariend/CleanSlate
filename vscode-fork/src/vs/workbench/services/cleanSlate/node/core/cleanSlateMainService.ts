/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRequestService } from '../../../../../platform/request/common/request.js';
import * as fs from 'fs';
import * as path from 'path';
import {
    AIProvider,
    ICleanSlateBackgroundCommandOptions,
    ICleanSlateBackgroundCommandResult,
    ICleanSlateBedrockConverseStreamOptions,
    ICleanSlateBedrockListModelsOptions,
    ICleanSlateAnthropicListModelsOptions,
    ICleanSlateAnthropicMessagesOptions,
    ICleanSlateCommandExecutionOptions,
    ICleanSlateCommandExecutionResult,
    ICleanSlateCommandOutputEvent,
    ICleanSlateGeminiGenerateContentOptions,
    ICleanSlateGeminiListModelsOptions,
    ICleanSlateLocalEmbeddingOptions,
    ICleanSlateLocalEmbeddingResponse,
    ICleanSlateMainService,
    ICleanSlateModelsDevModelMetadata,
    ICleanSlateBufferedRequestResponse,
    ICleanSlateOpenAICompatibleChatOptions,
    ICleanSlateOpenAICompatibleListModelsOptions,
    ICleanSlateOpenAIResponsesOptions,
    ICleanSlatePlaywrightBrowserRequest,
    ICleanSlatePersistedSession,
    ICleanSlateRuntimeConfig,
    ICleanSlateStopBackgroundCommandResult,
    ICleanSlateThreadSessionUpdate,
    ICleanSlateWebFetchOptions,
    ICleanSlateWebFetchResponse,
    ICleanSlateWebSearchOptions,
    ICleanSlateWebSearchResponse
} from '../../common/core/cleanSlateAI.js';
import { normalizeToolName } from '@cleanslate/sdk/protocol/cleanSlateProviderMessageTransforms.js';
import { parseEnvFile } from '../../../../../base/common/envfile.js';
import { IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { listenStream } from '../../../../../base/common/stream.js';
import { VSBuffer, streamToBuffer } from '../../../../../base/common/buffer.js';
import { CleanSlateCommandExecutionService } from './cleanSlateCommandExecutionService.js';
import { CleanSlatePlaywrightBrowserService } from './cleanSlatePlaywrightBrowserService.js';
import { INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CleanSlateThreadPersistenceStore } from './cleanSlateThreadPersistenceStore.js';
import { CleanSlateWebRetrievalService } from './cleanSlateWebRetrievalService.js';
import { CleanSlateLocalEmbeddingService } from './cleanSlateLocalEmbeddingService.js';
import { CleanSlateProviderSchemaNormalizer } from '@cleanslate/sdk/node/cleanSlateProviderSchemaNormalizer.js';
import {
    resolveArchivedSessionWorkspaceId,
    toArchivedSessionSnapshot
} from '@cleanslate/sdk/protocol/cleanSlateThreadSession.js';
import {
    messageContentToText,
    toGeminiContents
} from '@cleanslate/sdk/protocol/cleanSlateProviderTranscript.js';
import {
    buildCleanSlateRuntimeConfig,
    CleanSlateEnvLookup,
    normalizeBaseUrlValue,
    normalizeEnvValue,
    resolveCleanSlateManagedBaseUrl
} from '@cleanslate/sdk/protocol/cleanSlateRuntimeConfig.js';
import {
    findModelsDevMetadata,
    isValidModelsDevCatalog,
    MODELS_DEV_CACHE_TTL_MS,
    MODELS_DEV_CATALOG_URL
} from '@cleanslate/sdk/protocol/cleanSlateModelsDevCatalog.js';
import { CleanSlateOpenAIMessageAdapter } from '@cleanslate/sdk/node/cleanSlateOpenAIMessageAdapter.js';
import { CleanSlateAnthropicMessageAdapter } from '@cleanslate/sdk/node/cleanSlateAnthropicMessageAdapter.js';

interface IReasoningTagSplitState {
    inside: boolean;
    pending: string;
    // An opening <think> has been seen this turn — once true, leading-reasoning
    // capture is disabled and only matched <think>…</think> spans are split.
    sawOpen: boolean;
    // Reasoning-configured request: capture a leading reasoning span that has no
    // opening <think> (DeepSeek-R1 style, terminated by a stray </think>) instead
    // of leaking it as visible text.
    holdLeading: boolean;
}

// Upper bound on leading content held while waiting to see whether an unmatched
// </think> will arrive. Beyond this we assume it is a direct answer and stream it,
// so a non-reasoning turn is never withheld unbounded.
const LEADING_REASONING_HOLD_CAP_CHARS = 8_000;

export class NodeCleanSlateMainService extends Disposable implements ICleanSlateMainService {

    declare readonly _serviceBrand: undefined;
    private static readonly MODEL_LIST_TIMEOUT_MS = 30_000;
    private static readonly PROVIDER_STREAM_IDLE_TIMEOUT_MS = 120_000;

    private readonly commandExecutionService = this._register(new CleanSlateCommandExecutionService());
    private readonly browserService: CleanSlatePlaywrightBrowserService;
    private readonly providerSchemaNormalizer = new CleanSlateProviderSchemaNormalizer();
    private readonly openAIMessageAdapter = new CleanSlateOpenAIMessageAdapter();
    private readonly anthropicMessageAdapter = new CleanSlateAnthropicMessageAdapter(this.providerSchemaNormalizer);
    private readonly _onDidPublishThreadSession = this._register(new Emitter<ICleanSlateThreadSessionUpdate>());
    readonly onDidPublishThreadSession: Event<ICleanSlateThreadSessionUpdate> = this._onDidPublishThreadSession.event;
    private readonly webRetrievalService: CleanSlateWebRetrievalService;
    private readonly threadPersistenceStore: CleanSlateThreadPersistenceStore;
    private readonly localEmbeddingService: CleanSlateLocalEmbeddingService;
    private cleanSlateEnvCache: Map<string, string> | undefined;
    private modelsDevCatalogCache: { expiresAt: number; value: Record<string, any> } | undefined;
    private modelsDevCatalogRequest: Promise<Record<string, any> | undefined> | undefined;

    constructor(
        @IRequestService private readonly requestService: IRequestService,
        @INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
        @ILogService private readonly logService: ILogService
    ) {
        super();
        this.browserService = this._register(new CleanSlatePlaywrightBrowserService(this.environmentService.userDataPath, this.logService));
        this.webRetrievalService = new CleanSlateWebRetrievalService(this.requestService, this.logService);
        this.threadPersistenceStore = this._register(new CleanSlateThreadPersistenceStore(this.environmentService, this.logService));
        this.localEmbeddingService = new CleanSlateLocalEmbeddingService(this.environmentService, this.logService);
    }

    getRuntimeConfig(): Promise<ICleanSlateRuntimeConfig> {
        return Promise.resolve(buildCleanSlateRuntimeConfig(this.envLookup));
    }


    async proxyRequest(options: IRequestOptions, token: CancellationToken): Promise<ICleanSlateBufferedRequestResponse> {
        const context = await this.requestService.request(options, token);
        const data = await streamToBuffer(context.stream);
        return {
            res: {
                statusCode: context.res.statusCode,
                headers: context.res.headers
            },
            data: data.toString()
        };
    }

    proxyStream(options: IRequestOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        const emitter = new Emitter<VSBuffer | string | null>();

        this.requestService.request(options, token).then(async context => {
            const statusCode = context.res.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
                try {
                    const data = await streamToBuffer(context.stream);
                    const message = data.toString() || `HTTP ${statusCode}`;
                    emitter.fire(`ERROR: HTTP ${statusCode}: ${message}`);
                } catch (err) {
                    emitter.fire(`ERROR: HTTP ${statusCode}`);
                }
                emitter.fire(null);
                return;
            }

            listenStream(context.stream, {
                onData: (chunk: VSBuffer) => {
                    emitter.fire(chunk);
                },
                onError: (err: Error) => {
                    emitter.fire(`ERROR: ${err.message}`);
                    emitter.fire(null);
                },
                onEnd: () => {
                    emitter.fire(null);
                }
            }, token);
        }).catch(err => {
            emitter.fire(`ERROR: ${err.message}`);
            emitter.fire(null);
        });

        return emitter.event;
    }

    async getModelsDevModelMetadata(provider: AIProvider, model: string, token: CancellationToken): Promise<ICleanSlateModelsDevModelMetadata | undefined> {
        const normalizedModel = model.trim();
        if (!normalizedModel) {
            return undefined;
        }
        return findModelsDevMetadata(await this.getModelsDevCatalog(token), provider, normalizedModel);
    }

    private async getModelsDevCatalog(token: CancellationToken): Promise<Record<string, any> | undefined> {
        if (this.modelsDevCatalogCache && this.modelsDevCatalogCache.expiresAt > Date.now()) {
            return this.modelsDevCatalogCache.value;
        }
        if (!this.modelsDevCatalogRequest) {
            this.modelsDevCatalogRequest = (async () => {
                try {
                    const context = await this.requestService.request({
                        url: MODELS_DEV_CATALOG_URL,
                        type: 'GET',
                        timeout: NodeCleanSlateMainService.MODEL_LIST_TIMEOUT_MS,
                        disableCache: true
                    }, token);
                    const statusCode = context.res.statusCode ?? 0;
                    if (statusCode < 200 || statusCode >= 300) {
                        throw new Error(`HTTP ${statusCode}`);
                    }
                    const parsed = JSON.parse((await streamToBuffer(context.stream)).toString());
                    if (!isValidModelsDevCatalog(parsed)) {
                        throw new Error('invalid catalog shape');
                    }
                    this.modelsDevCatalogCache = {
                        expiresAt: Date.now() + MODELS_DEV_CACHE_TTL_MS,
                        value: parsed
                    };
                    return parsed;
                } catch (error) {
                    this.logService.warn(`[CleanSlate] models.dev capability catalog unavailable; using local fallbacks: ${String(error)}`);
                    return undefined;
                } finally {
                    this.modelsDevCatalogRequest = undefined;
                }
            })();
        }
        return this.modelsDevCatalogRequest;
    }

    webSearch(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<ICleanSlateWebSearchResponse> {
        return this.webRetrievalService.search(options, token);
    }

    webFetch(options: ICleanSlateWebFetchOptions, token: CancellationToken): Promise<ICleanSlateWebFetchResponse> {
        return this.webRetrievalService.fetch(options, token);
    }

    localEmbeddings(options: ICleanSlateLocalEmbeddingOptions, token: CancellationToken): Promise<ICleanSlateLocalEmbeddingResponse> {
        return this.localEmbeddingService.embed(options, token);
    }

    async listOpenAICompatibleModels(options: ICleanSlateOpenAICompatibleListModelsOptions, token: CancellationToken): Promise<string[]> {
        if (!options.apiKey && !this.isCustomProviderName(options.providerName)) {
            throw new Error('API key is required for OpenAI-compatible model listing.');
        }
        if (this.isCustomProviderName(options.providerName) && !this.resolveOpenAICompatibleBaseUrl(options)) {
            throw new Error('Base URL is required for Custom API model listing.');
        }

        const client = await this.createOpenAICompatibleClient(options);
        const abort = this.createProviderAbortController(token, NodeCleanSlateMainService.MODEL_LIST_TIMEOUT_MS);
        try {
            const response = await client.models.list({}, { signal: abort.signal });
            const models = Array.isArray(response?.data) ? response.data : [];
            return models
                .map((model: any) => typeof model?.id === 'string' ? model.id : undefined)
                .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
                .sort((a: string, b: string) => a.localeCompare(b));
        } catch (error) {
            throw new Error(this.toProviderErrorMessage(error, abort, 'OpenAI-compatible model listing'));
        } finally {
            abort.dispose();
        }
    }

    openAICompatibleChatStream(options: ICleanSlateOpenAICompatibleChatOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        const emitter = new Emitter<VSBuffer | string | null>();

        (async () => {
            let abort: ReturnType<NodeCleanSlateMainService['createProviderAbortController']> | undefined;
            try {
                if (!options.apiKey && !this.isCustomProviderName(options.providerName)) {
                    throw new Error(`${options.providerName} API key is required.`);
                }
                if (!options.model) {
                    throw new Error(`${options.providerName} model is required.`);
                }
                if (this.isCustomProviderName(options.providerName) && !this.resolveOpenAICompatibleBaseUrl(options)) {
                    throw new Error('Custom API base URL is required.');
                }

                const client = await this.createOpenAICompatibleClient(options);
                const body: any = {
                    model: options.model,
                    stream: true,
                    messages: options.messages.map((message, index) => this.openAIMessageAdapter.toChatMessage(message, index))
                };
                if (options.store !== undefined) {
                    body.store = options.store;
                }
                if (options.promptCacheKey) {
                    body.prompt_cache_key = options.promptCacheKey;
                }

                const maxOutputTokens = Number.isFinite(options.maxOutputTokens) && options.maxOutputTokens! > 0
                    ? Math.floor(options.maxOutputTokens!)
                    : undefined;
                if (options.useMaxCompletionTokens) {
                    if (maxOutputTokens !== undefined) {
                        body.max_completion_tokens = maxOutputTokens;
                    }
                    if (options.reasoningEffort) {
                        body.reasoning_effort = options.reasoningEffort;
                    }
                } else {
                    if (maxOutputTokens !== undefined) {
                        body.max_tokens = maxOutputTokens;
                    }
                    if (options.temperature !== undefined) {
                        body.temperature = options.temperature;
                    }
                    if (options.topP !== undefined) {
                        body.top_p = options.topP;
                    }
                    if (options.topK !== undefined && !options.azure && options.providerName !== 'OpenAI') {
                        body.top_k = options.topK;
                    }
                    if (options.reasoningEffort) {
                        body.reasoning_effort = options.reasoningEffort;
                    }
                }
                if (options.bodyOptions) {
                    Object.assign(body, options.bodyOptions);
                }

                if (options.options?.tools?.length) {
                    body.tools = options.options.tools.map(tool => ({
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: this.providerSchemaNormalizer.normalizeJsonObjectSchema(tool.parametersSchema, { target: 'openaiCompatible', model: options.model })
                        }
                    }));
                    body.tool_choice = options.options.requiredToolName
                        ? { type: 'function', function: { name: options.options.requiredToolName } }
                        : 'auto';
                    if (options.parallelToolCalls && !options.options.requiredToolName && options.reasoningEffort !== 'minimal') {
                        body.parallel_tool_calls = true;
                    }
                }

                // The managed "CleanSlate Pro" provider streams like every other
                // OpenAI-compatible host (the backend proxies Azure's SSE straight
                // through). It used to force stream:false and buffer the whole
                // completion, which made long agentic turns idle out into a bare
                // 502 at the gateway; streaming keeps bytes flowing so it doesn't.
                abort = this.createProviderAbortController(token, NodeCleanSlateMainService.PROVIDER_STREAM_IDLE_TIMEOUT_MS);
                const stream = await client.chat.completions.create(body, { signal: abort.signal });
                const toolCalls = new Map<number, { id?: string; name: string; argumentsJson: string }>();
                const emittedToolCallIndexes = new Set<number>();
                let lastUsageSignature: string | undefined;
                const emitBufferedToolCalls = () => {
                    for (const [index, toolCall] of toolCalls.entries()) {
                        if (emittedToolCallIndexes.has(index) || !toolCall.name) {
                            continue;
                        }
                        emittedToolCallIndexes.add(index);
                        this.emitProviderPart(emitter, {
                            type: 'tool_call',
                            call: {
                                id: toolCall.id || `call_${index}`,
                                toolName: toolCall.name,
                                input: this.parseToolInput(toolCall.argumentsJson)
                            }
                        });
                    }
                };

                // Some OSS reasoning models (DeepSeek-R1, QwQ, Qwen3-thinking) served by
                // raw vLLM/Ollama/llama.cpp stream reasoning inline in content wrapped in
                // <think>...</think> instead of a dedicated field — and some omit the
                // opening tag entirely, closing with a stray </think>. Split both out.
                // Leading-reasoning capture only runs for reasoning-configured requests.
                const thinkState: IReasoningTagSplitState = { inside: false, pending: '', sawOpen: false, holdLeading: options.reasoningEffort !== undefined };

                for await (const chunk of stream as AsyncIterable<any>) {
                    abort.touch();
                    if (token.isCancellationRequested) {
                        break;
                    }

                    const delta = chunk?.choices?.[0]?.delta ?? {};
                    const usage = this.toProviderUsage(chunk?.usage);
                    if (usage) {
                        const signature = JSON.stringify(usage);
                        if (signature !== lastUsageSignature) {
                            lastUsageSignature = signature;
                            this.emitProviderPart(emitter, { type: 'usage', usage });
                        }
                    }
                    const content = delta.content;
                    // OpenAI-compatible hosts expose hidden reasoning under
                    // provider-specific fields such as reasoning_content or reasoning.
                    // Surface it on the dedicated reasoning lane, never merged into
                    // assistant text.
                    const reasoningDelta = this.extractOpenAICompatibleReasoningDelta(delta);
                    if (reasoningDelta) {
                        this.emitProviderPart(emitter, { type: 'reasoning', content: reasoningDelta });
                    }
                    if (typeof content === 'string' && content.length > 0) {
                        const split = this.splitInlineReasoningTags(content, thinkState);
                        if (split.reasoning.length > 0) {
                            this.emitProviderPart(emitter, { type: 'reasoning', content: split.reasoning });
                        }
                        if (split.text.length > 0) {
                            this.emitProviderPart(emitter, { type: 'text', content: split.text });
                        }
                    }
                    if (Array.isArray(delta.tool_calls)) {
                        for (const toolCallDelta of delta.tool_calls) {
                            const index = Number.isFinite(toolCallDelta.index) ? toolCallDelta.index : toolCalls.size;
                            const existing = toolCalls.get(index) ?? { name: '', argumentsJson: '' };
                            if (typeof toolCallDelta.id === 'string') {
                                existing.id = toolCallDelta.id;
                            }
                            if (typeof toolCallDelta.function?.name === 'string') {
                                existing.name = toolCallDelta.function.name;
                            }
                            if (typeof toolCallDelta.function?.arguments === 'string') {
                                existing.argumentsJson += toolCallDelta.function.arguments;
                            }
                            toolCalls.set(index, existing);
                        }
                    }
                    const finishReason = chunk?.choices?.[0]?.finish_reason;
                    if (finishReason === 'tool_calls') {
                        emitBufferedToolCalls();
                    }
                }

                if (thinkState.pending.length > 0) {
                    this.emitProviderPart(emitter, {
                        type: thinkState.inside ? 'reasoning' : 'text',
                        content: thinkState.pending
                    });
                    thinkState.pending = '';
                }
                emitBufferedToolCalls();
            } catch (error: any) {
                emitter.fire(`ERROR: ${this.toProviderErrorMessage(error, abort, options.providerName)}`);
            } finally {
                abort?.dispose();
                emitter.fire(null);
            }
        })();

        return emitter.event;
    }

    openAIResponsesStream(options: ICleanSlateOpenAIResponsesOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        const emitter = new Emitter<VSBuffer | string | null>();

        (async () => {
            let abort: ReturnType<NodeCleanSlateMainService['createProviderAbortController']> | undefined;
            try {
                if (!options.apiKey) {
                    throw new Error(`${options.providerName} API key is required.`);
                }
                if (!options.model) {
                    throw new Error(`${options.providerName} model is required.`);
                }

                const client = await this.createOpenAICompatibleClient(options);
                if (typeof client.responses?.create !== 'function') {
                    throw new Error('OpenAI SDK does not expose the Responses API.');
                }

                const body: any = {
                    model: options.model,
                    stream: true,
                    input: this.openAIMessageAdapter.toResponsesInput(options.messages)
                };
                if (options.store !== undefined) {
                    body.store = options.store;
                }
                if (options.promptCacheKey) {
                    body.prompt_cache_key = options.promptCacheKey;
                }

                const maxOutputTokens = Number.isFinite(options.maxOutputTokens) && options.maxOutputTokens! > 0
                    ? Math.floor(options.maxOutputTokens!)
                    : undefined;
                if (maxOutputTokens !== undefined) {
                    body.max_output_tokens = maxOutputTokens;
                }
                if (options.reasoningEffort) {
                    body.reasoning = { effort: options.reasoningEffort };
                    if (options.reasoningSummary && options.reasoningEffort !== 'none') {
                        body.reasoning.summary = options.reasoningSummary;
                    }
                }
                if (options.include?.length) {
                    body.include = options.include;
                }
                if (options.bodyOptions) {
                    Object.assign(body, options.bodyOptions);
                }

                if (options.options?.tools?.length) {
                    body.tools = options.options.tools.map(tool => ({
                        type: 'function',
                        name: tool.name,
                        description: tool.description,
                        parameters: this.providerSchemaNormalizer.normalizeJsonObjectSchema(tool.parametersSchema, { target: 'openaiCompatible', model: options.model })
                    }));
                    body.tool_choice = options.options.requiredToolName
                        ? { type: 'function', name: options.options.requiredToolName }
                        : 'auto';
                    if (options.parallelToolCalls && !options.options.requiredToolName && options.reasoningEffort !== 'minimal') {
                        body.parallel_tool_calls = true;
                    }
                }

                abort = this.createProviderAbortController(token, NodeCleanSlateMainService.PROVIDER_STREAM_IDLE_TIMEOUT_MS);
                const stream = await client.responses.create(body, { signal: abort.signal });
                const toolCalls = new Map<string, { id?: string; name: string; argumentsJson: string }>();
                const emittedToolCallKeys = new Set<string>();
                const outputTextPhases = new Map<string, 'commentary' | 'final_answer'>();
                const toolCallKey = (event: any): string => String(event?.item_id ?? event?.output_index ?? toolCalls.size);
                const rememberOutputTextPhase = (event: any, item: any): void => {
                    const phase = item?.phase;
                    if (phase !== 'commentary' && phase !== 'final_answer') {
                        return;
                    }
                    for (const key of [event?.item_id, item?.id, event?.output_index]) {
                        if (key !== undefined && key !== null) {
                            outputTextPhases.set(String(key), phase);
                        }
                    }
                };
                const getOutputTextPhase = (event: any): 'commentary' | 'final_answer' | undefined => {
                    for (const key of [event?.item_id, event?.output_index]) {
                        if (key !== undefined && key !== null) {
                            const phase = outputTextPhases.get(String(key));
                            if (phase) {
                                return phase;
                            }
                        }
                    }
                    return undefined;
                };
                const emitBufferedToolCall = (key: string) => {
                    const toolCall = toolCalls.get(key);
                    if (!toolCall || emittedToolCallKeys.has(key) || !toolCall.name) {
                        return;
                    }
                    emittedToolCallKeys.add(key);
                    this.emitProviderPart(emitter, {
                        type: 'tool_call',
                        call: {
                            id: toolCall.id || key,
                            toolName: toolCall.name,
                            input: this.parseToolInput(toolCall.argumentsJson)
                        }
                    });
                };
                const rememberFunctionCall = (key: string, item: any) => {
                    const existing = toolCalls.get(key) ?? { name: '', argumentsJson: '' };
                    if (typeof item?.id === 'string') {
                        existing.id = item.id;
                    }
                    if (typeof item?.call_id === 'string') {
                        existing.id = item.call_id;
                    }
                    if (typeof item?.name === 'string') {
                        existing.name = item.name;
                    }
                    if (typeof item?.arguments === 'string' && item.arguments.length > 0) {
                        existing.argumentsJson = item.arguments;
                    }
                    toolCalls.set(key, existing);
                };

                for await (const event of stream as AsyncIterable<any>) {
                    abort.touch();
                    if (token.isCancellationRequested) {
                        break;
                    }

                    if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
                        const phase = getOutputTextPhase(event);
                        this.emitProviderPart(emitter, {
                            type: 'text',
                            content: event.delta,
                            ...(phase ? { phase } : {})
                        });
                        continue;
                    }
                    if (event?.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') {
                        this.emitProviderPart(emitter, { type: 'reasoning', content: event.delta });
                        continue;
                    }
                    if (event?.type === 'response.output_item.added') {
                        if (event.item?.type === 'function_call') {
                            rememberFunctionCall(toolCallKey(event), event.item);
                        } else if (event.item?.type === 'message') {
                            rememberOutputTextPhase(event, event.item);
                        }
                        continue;
                    }
                    if (event?.type === 'response.function_call_arguments.delta') {
                        const key = toolCallKey(event);
                        const existing = toolCalls.get(key) ?? { name: '', argumentsJson: '' };
                        if (typeof event.delta === 'string') {
                            existing.argumentsJson += event.delta;
                        }
                        toolCalls.set(key, existing);
                        continue;
                    }
                    if (event?.type === 'response.function_call_arguments.done') {
                        const key = toolCallKey(event);
                        const existing = toolCalls.get(key) ?? { name: '', argumentsJson: '' };
                        if (typeof event.name === 'string') {
                            existing.name = event.name;
                        }
                        if (typeof event.arguments === 'string') {
                            existing.argumentsJson = event.arguments;
                        }
                        toolCalls.set(key, existing);
                        emitBufferedToolCall(key);
                        continue;
                    }
                    if (event?.type === 'response.output_item.done' && event.item?.type === 'function_call') {
                        const key = toolCallKey(event);
                        rememberFunctionCall(key, event.item);
                        emitBufferedToolCall(key);
                        continue;
                    }
                    if (event?.type === 'response.completed' && Array.isArray(event.response?.output)) {
						const usage = this.toProviderUsage(event.response?.usage);
						if (usage) {
							this.emitProviderPart(emitter, { type: 'usage', usage });
						}
                        for (const [index, item] of event.response.output.entries()) {
                            if (item?.type === 'function_call') {
                                const key = String(item.id ?? item.call_id ?? index);
                                rememberFunctionCall(key, item);
                                emitBufferedToolCall(key);
                            }
                        }
                    }
                }

                for (const key of toolCalls.keys()) {
                    emitBufferedToolCall(key);
                }
            } catch (error: any) {
                emitter.fire(`ERROR: ${this.toProviderErrorMessage(error, abort, options.providerName)}`);
            } finally {
                abort?.dispose();
                emitter.fire(null);
            }
        })();

        return emitter.event;
    }

    async listAnthropicModels(options: ICleanSlateAnthropicListModelsOptions, token: CancellationToken): Promise<string[]> {
        if (!options.apiKey) {
            throw new Error('Anthropic API key is required for model listing.');
        }

        const client = await this.createAnthropicClient(options);
        const abort = this.createProviderAbortController(token, NodeCleanSlateMainService.MODEL_LIST_TIMEOUT_MS);
        try {
            const page = await client.models.list({ limit: 100 }, { signal: abort.signal });
            const data = Array.isArray(page?.data) ? page.data : [];
            return data
                .map((model: any) => typeof model?.id === 'string' ? model.id : undefined)
                .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
                .sort((a: string, b: string) => a.localeCompare(b));
        } catch (error) {
            throw new Error(this.toProviderErrorMessage(error, abort, 'Anthropic model listing'));
        } finally {
            abort.dispose();
        }
    }

    anthropicMessagesStream(options: ICleanSlateAnthropicMessagesOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        const emitter = new Emitter<VSBuffer | string | null>();

        (async () => {
            let abort: ReturnType<NodeCleanSlateMainService['createProviderAbortController']> | undefined;
            try {
                if (!options.apiKey) {
                    throw new Error('Anthropic API key is required.');
                }
                if (!options.model) {
                    throw new Error('Anthropic model is required.');
                }

                const client = await this.createAnthropicClient(options);
                const body = this.anthropicMessageAdapter.toMessagesRequest(options);
                abort = this.createProviderAbortController(token, NodeCleanSlateMainService.PROVIDER_STREAM_IDLE_TIMEOUT_MS);
                const stream = await client.messages.create(body, { signal: abort.signal });

                let currentToolUseId: string | null = null;
                let currentToolName: string | null = null;
                let currentInputJson = '';

                for await (const event of stream as AsyncIterable<any>) {
                    abort.touch();
                    if (token.isCancellationRequested) {
                        break;
                    }

                    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                        currentToolUseId = event.content_block.id;
                        currentToolName = event.content_block.name;
                        currentInputJson = '';
                        continue;
                    }

                    if (event.type === 'content_block_delta') {
                        if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
                            this.emitProviderPart(emitter, { type: 'text', content: event.delta.text });
                        } else if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
                            this.emitProviderPart(emitter, { type: 'reasoning', content: event.delta.thinking });
                        } else if (event.delta?.type === 'input_json_delta' && typeof event.delta.partial_json === 'string') {
                            currentInputJson += event.delta.partial_json;
                        }
                        continue;
                    }

                    if (event.type === 'content_block_stop' && currentToolUseId && currentToolName) {
                        this.emitProviderPart(emitter, {
                            type: 'tool_call',
                            call: {
                                id: currentToolUseId,
                                toolName: currentToolName,
                                input: this.parseToolInput(currentInputJson)
                            }
                        });
                        currentToolUseId = null;
                        currentToolName = null;
                        currentInputJson = '';
                    }
                }
            } catch (error: any) {
                emitter.fire(`ERROR: ${this.toProviderErrorMessage(error, abort, 'Anthropic')}`);
            } finally {
                abort?.dispose();
                emitter.fire(null);
            }
        })();

        return emitter.event;
    }

    async listGeminiModels(options: ICleanSlateGeminiListModelsOptions, token: CancellationToken): Promise<string[]> {
        if (!options.apiKey) {
            throw new Error('Google Gemini API key is required for model listing.');
        }

        const client = await this.createGeminiClient(options);
        const pager = await client.models.list({ config: { pageSize: 100 } });
        const models: string[] = [];
        for await (const model of pager as AsyncIterable<any>) {
            if (token.isCancellationRequested) {
                break;
            }
            const actions = Array.isArray(model?.supportedActions) ? model.supportedActions : [];
            if (actions.length && !actions.includes('generateContent')) {
                continue;
            }
            const name = typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : undefined;
            if (name) {
                models.push(name);
            }
        }
        return Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));
    }

    geminiGenerateContentStream(options: ICleanSlateGeminiGenerateContentOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        const emitter = new Emitter<VSBuffer | string | null>();

        (async () => {
            let abort: ReturnType<NodeCleanSlateMainService['createProviderAbortController']> | undefined;
            try {
                if (!options.apiKey) {
                    throw new Error('Google Gemini API key is required.');
                }
                if (!options.model) {
                    throw new Error('Google Gemini model is required.');
                }

                const client = await this.createGeminiClient(options);
                const googleModule = await this.importExternalModule<any>('@google/genai');
                const { contents, systemInstruction } = toGeminiContents(options.messages);
                abort = this.createProviderAbortController(token, NodeCleanSlateMainService.PROVIDER_STREAM_IDLE_TIMEOUT_MS);
                const config: any = {
                    maxOutputTokens: options.maxOutputTokens || 16384,
                    abortSignal: abort.signal,
                    automaticFunctionCalling: {
                        disable: true,
                        ignoreCallHistory: true
                    }
                };
                if (options.temperature !== undefined) {
                    config.temperature = options.temperature;
                }
                if (options.topP !== undefined) {
                    config.topP = options.topP;
                }
                if (options.topK !== undefined) {
                    config.topK = options.topK;
                }
                if (options.thinkingConfig) {
                    config.thinkingConfig = options.thinkingConfig;
                }

                if (systemInstruction) {
                    config.systemInstruction = systemInstruction;
                }
                if (options.options?.tools?.length) {
                    config.tools = [{
                        functionDeclarations: options.options.tools.map(tool => ({
                            name: normalizeToolName(tool.name, 'gemini') ?? tool.name,
                            description: tool.description,
                            parametersJsonSchema: this.providerSchemaNormalizer.normalizeJsonObjectSchema(tool.parametersSchema, { target: 'gemini', model: options.model })
                        }))
                    }];
                    const requiredToolName = normalizeToolName(options.options.requiredToolName, 'gemini');
                    config.toolConfig = {
                        functionCallingConfig: {
                            mode: options.options.requiredToolName
                                ? (googleModule.FunctionCallingConfigMode?.ANY ?? 'ANY')
                                : (googleModule.FunctionCallingConfigMode?.AUTO ?? 'AUTO'),
                            allowedFunctionNames: requiredToolName ? [requiredToolName] : undefined
                        }
                    };
                }

                const stream = await client.models.generateContentStream({
                    model: options.model,
                    contents,
                    config
                });
                const pendingToolCalls = new Map<string, { id: string; toolName: string; input: any; thoughtSignature?: string }>();

                for await (const chunk of stream as AsyncIterable<any>) {
                    abort.touch();
                    if (token.isCancellationRequested) {
                        break;
                    }

                    // Gemini streams reasoning as parts flagged thought: true; the
                    // chunk.text getter excludes them, so surface them separately on
                    // the reasoning lane.
                    const thoughtText = this.extractGeminiThoughtText(chunk);
                    if (thoughtText) {
                        this.emitProviderPart(emitter, { type: 'reasoning', content: thoughtText });
                    }

                    const text = chunk?.text;
                    if (typeof text === 'string' && text.length > 0) {
                        this.emitProviderPart(emitter, { type: 'text', content: text });
                    }

                    const functionCalls = this.extractGeminiFunctionCallParts(chunk);
                    for (const call of functionCalls) {
                        const toolName = typeof call?.name === 'string' ? call.name : '';
                        if (!toolName) {
                            continue;
                        }
                        this.collectGeminiPendingToolCall(pendingToolCalls, call);
                    }
                }

                for (const call of pendingToolCalls.values()) {
                    this.emitProviderPart(emitter, {
                        type: 'tool_call',
                        call: {
                            id: call.id,
                            toolName: call.toolName,
                            input: call.input,
                            providerMetadata: typeof call.thoughtSignature === 'string' && call.thoughtSignature.length > 0
                                ? { gemini: { thoughtSignature: call.thoughtSignature } }
                                : undefined
                        }
                    });
                }
            } catch (error: any) {
                emitter.fire(`ERROR: ${this.toProviderErrorMessage(error, abort, 'Google Gemini')}`);
            } finally {
                abort?.dispose();
                emitter.fire(null);
            }
        })();

        return emitter.event;
    }

    async listBedrockFoundationModels(options: ICleanSlateBedrockListModelsOptions, token: CancellationToken): Promise<string[]> {
        if (!options.region) {
            throw new Error('AWS region is required for Bedrock model listing.');
        }

        const { BedrockClient, ListFoundationModelsCommand } = await this.importExternalModule<any>('@aws-sdk/client-bedrock');
        const client = new BedrockClient(await this.createBedrockClientConfig(options));
        const abort = this.createProviderAbortController(token, NodeCleanSlateMainService.MODEL_LIST_TIMEOUT_MS);
        try {
            const response = await client.send(new ListFoundationModelsCommand({}), { abortSignal: abort.signal });
            const summaries = (response.modelSummaries ?? []) as Array<{ modelId?: string; outputModalities?: string[] }>;
            return summaries
                .filter((model: { modelId?: string; outputModalities?: string[] }) => model.modelId && (model.outputModalities ?? []).includes('TEXT'))
                .map((model: { modelId?: string }) => model.modelId!)
                .sort((a, b) => a.localeCompare(b));
        } catch (error) {
            throw new Error(this.toProviderErrorMessage(error, abort, 'AWS Bedrock model listing'));
        } finally {
            abort.dispose();
        }
    }

    bedrockConverseStream(options: ICleanSlateBedrockConverseStreamOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        const emitter = new Emitter<VSBuffer | string | null>();

        (async () => {
            let abort: ReturnType<NodeCleanSlateMainService['createProviderAbortController']> | undefined;
            try {
                if (!options.region) {
                    throw new Error('AWS region is required for Bedrock.');
                }
                if (!options.modelId) {
                    throw new Error('Bedrock model ID is required.');
                }

                const { BedrockRuntimeClient, ConverseStreamCommand } = await this.importExternalModule<any>('@aws-sdk/client-bedrock-runtime');
                const client = new BedrockRuntimeClient(await this.createBedrockClientConfig(options));
                const request = this.toProviderConverseRequest(options);
                abort = this.createProviderAbortController(token, NodeCleanSlateMainService.PROVIDER_STREAM_IDLE_TIMEOUT_MS);
                const response = await client.send(new ConverseStreamCommand(request), { abortSignal: abort.signal });
                const toolUses = new Map<number, { id: string; name: string; inputJson: string }>();
                // OSS models on Bedrock (DeepSeek-R1, Llama, Mistral) may stream reasoning
                // via reasoningContent OR inline as <think>...</think> within text.
                const thinkState: IReasoningTagSplitState = { inside: false, pending: '', sawOpen: false, holdLeading: false };

                for await (const event of (response.stream ?? []) as AsyncIterable<any>) {
                    abort.touch();
                    if (token.isCancellationRequested) {
                        break;
                    }

                    const start = event.contentBlockStart?.start?.toolUse;
                    if (start) {
                        const index = event.contentBlockStart?.contentBlockIndex ?? toolUses.size;
                        toolUses.set(index, {
                            id: start.toolUseId ?? `tool_${index}`,
                            name: start.name ?? '',
                            inputJson: ''
                        });
                        continue;
                    }

                    const delta = event.contentBlockDelta?.delta;
                    if (typeof delta?.text === 'string' && delta.text.length > 0) {
                        const split = this.splitInlineReasoningTags(delta.text, thinkState);
                        if (split.reasoning.length > 0) {
                            this.emitProviderPart(emitter, { type: 'reasoning', content: split.reasoning });
                        }
                        if (split.text.length > 0) {
                            this.emitProviderPart(emitter, { type: 'text', content: split.text });
                        }
                    }
                    if (typeof delta?.reasoningContent?.text === 'string' && delta.reasoningContent.text.length > 0) {
                        this.emitProviderPart(emitter, { type: 'reasoning', content: delta.reasoningContent.text });
                    }
                    if (delta?.toolUse?.input) {
                        const index = event.contentBlockDelta?.contentBlockIndex ?? 0;
                        const existing = toolUses.get(index) ?? { id: `tool_${index}`, name: '', inputJson: '' };
                        existing.inputJson += delta.toolUse.input;
                        toolUses.set(index, existing);
                    }

                    const stopIndex = event.contentBlockStop?.contentBlockIndex;
                    if (stopIndex !== undefined) {
                        const toolUse = toolUses.get(stopIndex);
                        if (toolUse?.name) {
                            this.emitProviderPart(emitter, {
                                type: 'tool_call',
                                call: {
                                    id: toolUse.id,
                                    toolName: toolUse.name,
                                    input: this.parseToolInput(toolUse.inputJson)
                                }
                            });
                            toolUses.delete(stopIndex);
                        }
                    }
                }

                if (thinkState.pending.length > 0) {
                    this.emitProviderPart(emitter, {
                        type: thinkState.inside ? 'reasoning' : 'text',
                        content: thinkState.pending
                    });
                    thinkState.pending = '';
                }
            } catch (error: any) {
                emitter.fire(`ERROR: ${this.toProviderErrorMessage(error, abort, 'AWS Bedrock')}`);
            } finally {
                abort?.dispose();
                emitter.fire(null);
            }
        })();

        return emitter.event;
    }

    private async createOpenAICompatibleClient(options: ICleanSlateOpenAICompatibleListModelsOptions): Promise<any> {
        const openAIModule = await this.importExternalModule<any>('openai');
        const azure = (options as ICleanSlateOpenAICompatibleChatOptions).azure;
        if (azure) {
            const AzureOpenAI = openAIModule.AzureOpenAI;
            if (!AzureOpenAI) {
                throw new Error('OpenAI SDK is installed but did not expose an AzureOpenAI client.');
            }
            return new AzureOpenAI({
                apiKey: options.apiKey,
                endpoint: azure.endpoint,
                deployment: azure.deploymentName,
                apiVersion: azure.apiVersion || '2024-12-01-preview'
            });
        }

        const OpenAI = openAIModule.OpenAI ?? openAIModule.default;
        if (!OpenAI) {
            throw new Error('OpenAI SDK is installed but did not expose an OpenAI client.');
        }
        const baseURL = this.resolveOpenAICompatibleBaseUrl(options);
        const managed = this.isCleanSlateManagedProviderName(options.providerName);
        const defaultHeaders = managed
            ? { 'User-Agent': 'CleanSlate/1.0' }
            : undefined;
        return new OpenAI({
            apiKey: options.apiKey || (this.isCustomProviderName(options.providerName) ? 'cleanslate-custom-api-key' : ''),
            baseURL,
            defaultHeaders,
            // The SDK retries 429s on the server's Retry-After. For a managed
            // usage-limit (which resets days away) that means the request hangs
            // on "Thinking" indefinitely. App-layer retryOnRateLimit already
            // handles genuine transient retries, so disable the SDK's own.
            ...(managed ? { maxRetries: 0 } : {})
        });
    }

    private resolveOpenAICompatibleBaseUrl(options: ICleanSlateOpenAICompatibleListModelsOptions): string | undefined {
        if (this.isCleanSlateManagedProviderName(options.providerName)) {
            return resolveCleanSlateManagedBaseUrl(this.envLookup);
        }
        const configured = normalizeBaseUrlValue(options.baseUrl);
        if (configured) {
            return configured;
        }

        if (this.isNvidiaProviderName(options.providerName)) {
            return normalizeBaseUrlValue(this.envLookup('CLEANSLATE_NVIDIA_BASE_URL'))
                || normalizeBaseUrlValue(this.envLookup('NVIDIA_BASE_URL'))
                || 'https://integrate.api.nvidia.com/v1';
        }

        if (this.isOpenRouterProviderName(options.providerName)) {
            return normalizeBaseUrlValue(this.envLookup('CLEANSLATE_OPENROUTER_BASE_URL'))
                || normalizeBaseUrlValue(this.envLookup('OPENROUTER_BASE_URL'))
                || 'https://openrouter.ai/api/v1';
        }

        return undefined;
    }

    private isNvidiaProviderName(providerName: string | undefined): boolean {
        return typeof providerName === 'string' && providerName.toLowerCase().includes('nvidia');
    }

    private isOpenRouterProviderName(providerName: string | undefined): boolean {
        return typeof providerName === 'string' && providerName.toLowerCase().includes('openrouter');
    }

    private isCustomProviderName(providerName: string | undefined): boolean {
        return typeof providerName === 'string' && providerName.toLowerCase().includes('custom');
    }

    private isCleanSlateManagedProviderName(providerName: string | undefined): boolean {
        return typeof providerName === 'string' && providerName.toLowerCase() === 'cleanslate pro';
    }


    private readonly envLookup: CleanSlateEnvLookup = name => {
        return normalizeEnvValue(process.env[name]) ?? normalizeEnvValue(this.getCleanSlateEnv().get(name));
    };

    private getCleanSlateEnv(): Map<string, string> {
        if (this.cleanSlateEnvCache) {
            return this.cleanSlateEnvCache;
        }

        const values = new Map<string, string>();
        for (const envPath of this.getCleanSlateEnvPaths()) {
            try {
                if (!fs.existsSync(envPath)) {
                    continue;
                }
                const parsed = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
                for (const [key, value] of parsed) {
                    if (!values.has(key)) {
                        values.set(key, value);
                    }
                }
            } catch (error) {
                this.logService.warn(`[CleanSlate] Failed to read env file ${envPath}: ${String(error)}`);
            }
        }
        this.cleanSlateEnvCache = values;
        return values;
    }

    private getCleanSlateEnvPaths(): string[] {
        const paths: string[] = [];
        const add = (value: string | undefined) => {
            if (value && !paths.includes(value)) {
                paths.push(value);
            }
        };

        add(path.join(process.cwd(), '.env'));
        add(path.join(process.cwd(), 'vscode-fork', '.env'));

        const appRoot = typeof (this.environmentService as any).appRoot === 'string'
            ? (this.environmentService as any).appRoot
            : undefined;
        if (appRoot) {
            add(path.join(appRoot, '.env'));
            add(path.join(appRoot, '..', '.env'));
            add(path.join(appRoot, '..', '..', '.env'));
            add(path.join(appRoot, '..', '..', '..', '.env'));
        }

        add(path.join(this.environmentService.userRoamingDataHome.fsPath, '.env'));
        return paths;
    }


    private async createAnthropicClient(options: ICleanSlateAnthropicListModelsOptions): Promise<any> {
        const anthropicModule = await this.importExternalModule<any>('@anthropic-ai/sdk');
        const Anthropic = anthropicModule.Anthropic ?? anthropicModule.default;
        if (!Anthropic) {
            throw new Error('Anthropic SDK is installed but did not expose an Anthropic client.');
        }
        return new Anthropic({
            apiKey: options.apiKey,
            baseURL: options.baseUrl || undefined
        });
    }

    private async createGeminiClient(options: ICleanSlateGeminiListModelsOptions): Promise<any> {
        const googleModule = await this.importExternalModule<any>('@google/genai');
        const GoogleGenAI = googleModule.GoogleGenAI;
        if (!GoogleGenAI) {
            throw new Error('Google GenAI SDK is installed but did not expose a GoogleGenAI client.');
        }
        return new GoogleGenAI({ apiKey: options.apiKey });
    }





    private extractGeminiThoughtText(chunk: any): string | undefined {
        const candidates = Array.isArray(chunk?.candidates) ? chunk.candidates : [];
        let thought = '';
        for (const candidate of candidates) {
            const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
            for (const part of parts) {
                if (part?.thought === true && typeof part.text === 'string') {
                    thought += part.text;
                }
            }
        }
        return thought.length > 0 ? thought : undefined;
    }

    private extractGeminiFunctionCallParts(chunk: any): Array<{ id?: string; name?: string; args?: any; thoughtSignature?: string }> {
        const calls: Array<{ id?: string; name?: string; args?: any; thoughtSignature?: string }> = [];
        const candidates = Array.isArray(chunk?.candidates) ? chunk.candidates : [];
        for (const candidate of candidates) {
            const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
            for (const part of parts) {
                if (!part?.functionCall) {
                    continue;
                }
                calls.push({
                    ...part.functionCall,
                    thoughtSignature: typeof part.thoughtSignature === 'string' ? part.thoughtSignature : undefined
                });
            }
        }
        if (calls.length > 0) {
            return calls;
        }
        return Array.isArray(chunk?.functionCalls) ? chunk.functionCalls : [];
    }

    private collectGeminiPendingToolCall(
        pendingToolCalls: Map<string, { id: string; toolName: string; input: any; thoughtSignature?: string }>,
        call: { id?: string; name?: string; args?: any; thoughtSignature?: string }
    ): void {
        const toolName = typeof call?.name === 'string' ? call.name : '';
        if (!toolName) {
            return;
        }
        const args = call.args && typeof call.args === 'object' ? call.args : {};
        const hasProviderId = typeof call.id === 'string' && call.id.length > 0;
        const semanticArgs = JSON.stringify(args);
        const key = hasProviderId
            ? `${call.id}:${toolName}:${semanticArgs}`
            : `semantic:${toolName}:${semanticArgs}`;
        const existing = pendingToolCalls.get(key);
        const id = hasProviderId
            ? call.id!
            : existing?.id ?? `call_${toolName}_${pendingToolCalls.size}`;
        pendingToolCalls.set(key, {
            id,
            toolName,
            input: args,
            thoughtSignature: typeof call.thoughtSignature === 'string' && call.thoughtSignature.length > 0
                ? call.thoughtSignature
                : existing?.thoughtSignature
        });
    }


    private async createBedrockClientConfig(options: ICleanSlateBedrockListModelsOptions): Promise<any> {
        const config: any = { region: options.region };
        if (options.credentialMode === 'accessKey') {
            if (!options.accessKeyId || !options.secretAccessKey) {
                throw new Error('Bedrock access key ID and secret access key are required for manual credential mode.');
            }
            config.credentials = {
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
                sessionToken: options.sessionToken || undefined
            };
            return config;
        }

        if (options.credentialMode === 'profile') {
            if (!options.profile) {
                throw new Error('AWS profile name is required for Bedrock profile credential mode.');
            }
            const { fromIni } = await this.importExternalModule<any>('@aws-sdk/credential-provider-ini');
            config.credentials = fromIni({ profile: options.profile });
            return config;
        }

        const { defaultProvider } = await this.importExternalModule<any>('@aws-sdk/credential-provider-node');
        config.credentials = defaultProvider();
        return config;
    }

    private async importExternalModule<T>(specifier: string): Promise<T> {
        return import(specifier) as Promise<T>;
    }

    private createProviderAbortController(token: CancellationToken, timeoutMs: number): { signal: AbortSignal; touch: () => void; dispose: () => void; isTimedOut: () => boolean; timeoutMs: number } {
        const controller = new AbortController();
        let timeoutHandle: any;
        let timedOut = false;

        const clearTimer = () => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = undefined;
            }
        };
        const armTimer = () => {
            clearTimer();
            if (timeoutMs > 0 && !controller.signal.aborted) {
                timeoutHandle = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                }, timeoutMs);
            }
        };
        const cancellation = token.onCancellationRequested(() => controller.abort());

        if (token.isCancellationRequested) {
            controller.abort();
        } else {
            armTimer();
        }

        return {
            signal: controller.signal,
            touch: armTimer,
            dispose: () => {
                clearTimer();
                cancellation.dispose();
            },
            isTimedOut: () => timedOut,
            timeoutMs
        };
    }

    private toProviderErrorMessage(error: unknown, abort: { isTimedOut: () => boolean; timeoutMs: number } | undefined, operation: string): string {
        if (abort?.isTimedOut()) {
            return `${operation} did not receive provider activity for ${Math.round(abort.timeoutMs / 1000)} seconds. Check the endpoint, API version, deployment/model name, credentials, and network.`;
        }

        return error instanceof Error ? error.message : String(error);
    }

    private toProviderConverseRequest(options: ICleanSlateBedrockConverseStreamOptions): any {
        const system: Array<{ text: string }> = [];
        const messages: any[] = [];

        for (let index = 0; index < options.messages.length; index++) {
            const message = options.messages[index];
            const text = messageContentToText(message.content);
            if (message.role === 'system') {
                if (text) {
                    system.push({ text });
                }
                continue;
            }

            if (message.role === 'tool') {
                const content: any[] = [];
                while (index < options.messages.length && options.messages[index].role === 'tool') {
                    const toolMessage = options.messages[index];
                    content.push({
                        toolResult: {
                            toolUseId: toolMessage.toolCallId || `tool_${index}`,
                            content: [{ text: messageContentToText(toolMessage.content) }]
                        }
                    });
                    index++;
                }
                index--;
                messages.push({
                    role: 'user',
                    content
                });
                continue;
            }

            const content: any[] = [];
            if (text) {
                content.push({ text });
            }
            if (message.role === 'assistant' && message.toolCalls?.length) {
                for (const [toolIndex, toolCall] of message.toolCalls.entries()) {
                    content.push({
                    toolUse: {
                        toolUseId: toolCall.id || `tool_${index}_${toolIndex}`,
                        name: normalizeToolName(toolCall.toolName, 'bedrock') ?? toolCall.toolName,
                        input: toolCall.input ?? {}
                    }
                    });
                }
            }

            if (content.length) {
                messages.push({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content
                });
            }
        }

        const request: any = {
            modelId: options.modelId,
            messages,
            inferenceConfig: {
                maxTokens: options.maxOutputTokens || 16384
            }
        };
        if (options.temperature !== undefined) {
            request.inferenceConfig.temperature = options.temperature;
        }
        if (options.topP !== undefined) {
            request.inferenceConfig.topP = options.topP;
        }
        if (options.additionalModelRequestFields) {
            request.additionalModelRequestFields = options.additionalModelRequestFields;
        }
        if (system.length) {
            request.system = system;
        }
        // AWS Bedrock requires toolConfig when messages contain toolUse/toolResult content blocks.
        // If no tools are provided but messages contain tool blocks, we must provide an empty tools array.
        const hasToolBlocks = messages.some(message => 
            (message.role === 'assistant' && message.content?.some((block: any) => block?.toolUse)) ||
            (message.role === 'user' && message.content?.some((block: any) => block?.toolResult))
        );

        if (options.options?.tools?.length) {
            request.toolConfig = {
                tools: options.options.tools.map(tool => ({
                    toolSpec: {
                        name: normalizeToolName(tool.name, 'bedrock') ?? tool.name,
                        description: tool.description,
                        inputSchema: { json: this.providerSchemaNormalizer.normalizeJsonObjectSchema(tool.parametersSchema, { target: 'bedrock', model: options.modelId }) }
                    }
                })),
                toolChoice: options.options.requiredToolName
                    ? { tool: { name: normalizeToolName(options.options.requiredToolName, 'bedrock') ?? options.options.requiredToolName } }
                    : undefined
            };
        } else if (hasToolBlocks) {
            // Provide minimal toolConfig to satisfy Bedrock validation when messages contain tool blocks
            request.toolConfig = {
                tools: []
            };
        }
        return request;
    }


    private parseToolInput(inputJson: string): any {
        if (!inputJson || inputJson.trim().length === 0) {
            return {};
        }
        try {
            return JSON.parse(inputJson);
        } catch (error) {
            // A call whose arguments fail to parse must never execute —
            // silently running it
            // with empty input corrupts the workspace state. The marker rides
            // the input to the agent loop, which returns the parse error to
            // the model as a failed tool result so it can re-issue the call.
            return {
                __cleanSlateArgumentsParseError: `failed to parse function arguments: ${error instanceof Error ? error.message : String(error)}`,
                __cleanSlateRawArguments: inputJson.slice(0, 400)
            };
        }
    }

    private emitProviderPart(emitter: Emitter<VSBuffer | string | null>, part: any): void {
        emitter.fire(`data: ${JSON.stringify(part)}\n\n`);
    }

    /** Normalises the usage payloads returned by OpenAI-compatible and Responses streams. */
    private toProviderUsage(usage: any): { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number } | undefined {
        if (!usage || typeof usage !== 'object') {
            return undefined;
        }
        const asNonNegativeInteger = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0
            ? Math.floor(value)
            : undefined;
        const inputTokens = asNonNegativeInteger(usage.input_tokens ?? usage.prompt_tokens);
        const outputTokens = asNonNegativeInteger(usage.output_tokens ?? usage.completion_tokens);
        const totalTokens = asNonNegativeInteger(usage.total_tokens);
        const cachedInputTokens = asNonNegativeInteger(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens);
        if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
            return undefined;
        }
        return { inputTokens, outputTokens, totalTokens, cachedInputTokens };
    }

    // Streaming splitter for inline <think>...</think> reasoning spans. Tags may
    // be split across deltas, so state persists across calls within one stream.
    private splitInlineReasoningTags(delta: string, state: IReasoningTagSplitState): { reasoning: string; text: string } {
        const OPEN = '<think>';
        const CLOSE = '</think>';
        state.pending += delta;
        let reasoning = '';
        let text = '';

        while (state.pending.length > 0) {
            if (state.inside) {
                const idx = state.pending.indexOf(CLOSE);
                if (idx === -1) {
                    const held = this.holdPartialTagSuffix(state.pending, CLOSE);
                    reasoning += state.pending.slice(0, state.pending.length - held);
                    state.pending = state.pending.slice(state.pending.length - held);
                    break;
                }
                reasoning += state.pending.slice(0, idx);
                state.pending = state.pending.slice(idx + CLOSE.length);
                state.inside = false;
                continue;
            }

            const openIdx = state.pending.indexOf(OPEN);
            // Reasoning-first models (DeepSeek-R1, QwQ, …) stream reasoning with no
            // opening <think>, terminated by a stray </think>. Until a real opening
            // tag is seen, treat a </think> that appears first as closing an implicit
            // reasoning span opened at the start of the turn.
            const closeIdx = state.sawOpen ? -1 : state.pending.indexOf(CLOSE);
            if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
                reasoning += state.pending.slice(0, closeIdx);
                state.pending = state.pending.slice(closeIdx + CLOSE.length);
                state.sawOpen = true; // implicit reasoning consumed; resume normal text handling
                continue;
            }

            if (openIdx !== -1) {
                text += state.pending.slice(0, openIdx);
                state.pending = state.pending.slice(openIdx + OPEN.length);
                state.inside = true;
                state.sawOpen = true;
                continue;
            }

            // No complete tag in the buffer. While a leading reasoning span is still
            // possible, hold the whole buffer rather than leak it as visible text —
            // bounded by the cap so a direct answer is never withheld unbounded.
            if (state.holdLeading && !state.sawOpen) {
                if (state.pending.length <= LEADING_REASONING_HOLD_CAP_CHARS) {
                    break;
                }
                state.holdLeading = false; // give up: treat the rest of the turn as normal text
            }
            const holdOpen = this.holdPartialTagSuffix(state.pending, OPEN);
            const holdClose = state.sawOpen ? 0 : this.holdPartialTagSuffix(state.pending, CLOSE);
            const held = Math.max(holdOpen, holdClose);
            text += state.pending.slice(0, state.pending.length - held);
            state.pending = state.pending.slice(state.pending.length - held);
            break;
        }

        return { reasoning, text };
    }

    // Length of the trailing suffix of `s` that is a non-empty prefix of `tag`,
    // so a tag split across deltas is never emitted half-formed.
    private holdPartialTagSuffix(s: string, tag: string): number {
        const max = Math.min(tag.length - 1, s.length);
        for (let k = max; k > 0; k--) {
            if (s.slice(s.length - k) === tag.slice(0, k)) {
                return k;
            }
        }
        return 0;
    }

    // OpenAI-compatible gateways expose streamed reasoning under a few different
    // field names. Normalize them into a single reasoning string delta.
    private extractOpenAICompatibleReasoningDelta(delta: any): string | undefined {
        if (!delta) {
            return undefined;
        }
        const candidate = delta.reasoning_content ?? delta.reasoning;
        if (typeof candidate === 'string' && candidate.length > 0) {
            return candidate;
        }
        if (Array.isArray(delta.reasoning_details)) {
            const joined = delta.reasoning_details
                .map((entry: any) => (typeof entry?.text === 'string' ? entry.text : ''))
                .join('');
            if (joined.length > 0) {
                return joined;
            }
        }
        return undefined;
    }

    executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
        return this.commandExecutionService.executeCommand(options);
    }

    executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken): Event<ICleanSlateCommandOutputEvent | null> {
        return this.commandExecutionService.executeCommandStream(options, token);
    }

    startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult> {
        return this.commandExecutionService.startBackgroundCommand(options);
    }

    stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult> {
        return this.commandExecutionService.stopBackgroundCommand(processId);
    }

    getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult> {
        return this.commandExecutionService.getBackgroundCommand(processId);
    }

    listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]> {
        return this.commandExecutionService.listBackgroundCommands();
    }

    browserPlaywright(request: ICleanSlatePlaywrightBrowserRequest): Promise<unknown> {
        return this.browserService.run(request);
    }

	loadThreadSession(sessionId: string): Promise<ICleanSlatePersistedSession | undefined> {
		return this.threadPersistenceStore.loadSession(sessionId);
	}

	loadActiveThreadSession(workspaceId: string): Promise<ICleanSlatePersistedSession | undefined> {
		return this.threadPersistenceStore.loadActiveSession(workspaceId);
	}

    saveActiveThreadSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void> {
        return this.threadPersistenceStore.saveActiveSession(workspaceId, session);
    }

    publishThreadSession(update: ICleanSlateThreadSessionUpdate): Promise<void> {
        this._onDidPublishThreadSession.fire(update);
        return this.persistPublishedThreadSession(update.session);
    }

    private persistPublishedThreadSession(session: ICleanSlatePersistedSession): Promise<void> {
        return this.threadPersistenceStore.archiveSession(
            resolveArchivedSessionWorkspaceId(session),
            toArchivedSessionSnapshot(session)
        ).catch(error => {
            this.logService.warn(`CleanSlate failed to persist published thread session: ${String(error)}`);
        });
    }

    clearActiveThreadSession(workspaceId: string): Promise<void> {
        return this.threadPersistenceStore.clearActiveSession(workspaceId);
    }

    listThreadSessions(): Promise<ICleanSlatePersistedSession[]> {
        return this.threadPersistenceStore.listSessions();
    }

    listArchivedThreadSessions(workspaceId: string): Promise<ICleanSlatePersistedSession[]> {
        return this.threadPersistenceStore.listArchivedSessions(workspaceId);
    }

    archiveThreadSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void> {
        return this.threadPersistenceStore.archiveSession(workspaceId, session);
    }

    removeThreadSession(sessionId: string): Promise<void> {
        return this.threadPersistenceStore.removeSession(sessionId);
    }

    removeArchivedThreadSession(workspaceId: string, sessionId: string): Promise<void> {
        return this.threadPersistenceStore.removeArchivedSession(workspaceId, sessionId);
    }
}
