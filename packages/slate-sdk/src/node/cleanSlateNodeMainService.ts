/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../core/buffer.js';
import { CancellationToken } from '../core/cancellation.js';
import { Emitter, Event } from '../core/event.js';
import { IRequestOptions } from '../host/services.js';
import {
	AIProvider,
	ICleanSlateAnthropicListModelsOptions,
	ICleanSlateAnthropicMessagesOptions,
	ICleanSlateBackgroundCommandOptions,
	ICleanSlateBackgroundCommandResult,
	ICleanSlateBedrockConverseStreamOptions,
	ICleanSlateBedrockListModelsOptions,
	ICleanSlateBufferedRequestResponse,
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult,
	ICleanSlateCommandOutputEvent,
	ICleanSlateGeminiGenerateContentOptions,
	ICleanSlateGeminiListModelsOptions,
	ICleanSlateLocalEmbeddingOptions,
	ICleanSlateLocalEmbeddingResponse,
	ICleanSlateMainService,
	ICleanSlateModelsDevModelMetadata,
	ICleanSlateOpenAICompatibleChatOptions,
	ICleanSlateOpenAICompatibleListModelsOptions,
	ICleanSlateOpenAIResponsesOptions,
	ICleanSlatePersistedSession,
	ICleanSlatePlaywrightBrowserRequest,
	ICleanSlateRuntimeConfig,
	ICleanSlateStopBackgroundCommandResult,
	ICleanSlateThreadSessionUpdate,
	ICleanSlateWebFetchOptions,
	ICleanSlateWebFetchResponse,
	ICleanSlateWebSearchOptions,
	ICleanSlateWebSearchResponse
} from '../protocol/cleanSlateAI.js';
import { CleanSlateNodeCommandService } from './cleanSlateNodeCommandService.js';
import { CleanSlateAnthropicMessageAdapter } from './cleanSlateAnthropicMessageAdapter.js';
import { CleanSlateOpenAIMessageAdapter } from './cleanSlateOpenAIMessageAdapter.js';
import { CleanSlateProviderSchemaNormalizer } from './cleanSlateProviderSchemaNormalizer.js';

interface IReasoningTagSplitState {
	inside: boolean;
	pending: string;
	sawOpen: boolean;
	holdLeading: boolean;
}

const LEADING_REASONING_HOLD_CAP_CHARS = 8_000;

/**
 * Node implementation of the provider-facing service used by CleanSlateService.
 *
 * Provider SDK events are adapted into CleanSlate's framed part stream. Methods
 * that require an editor-owned capability deliberately reject on this surface.
 */
export class NodeCleanSlateMainService implements ICleanSlateMainService {
	declare readonly _serviceBrand: undefined;
	private static readonly MODEL_LIST_TIMEOUT_MS = 30_000;
	private static readonly PROVIDER_STREAM_IDLE_TIMEOUT_MS = 120_000;

	private readonly providerSchemaNormalizer = new CleanSlateProviderSchemaNormalizer();
	private readonly openAIMessageAdapter = new CleanSlateOpenAIMessageAdapter();
	private readonly anthropicMessageAdapter = new CleanSlateAnthropicMessageAdapter(this.providerSchemaNormalizer);
	private readonly commandService: CleanSlateNodeCommandService;
	readonly onDidPublishThreadSession: Event<ICleanSlateThreadSessionUpdate> = Event.None;

	constructor(rootPath: string = process.cwd()) {
		this.commandService = new CleanSlateNodeCommandService(rootPath);
	}

	getRuntimeConfig(): Promise<ICleanSlateRuntimeConfig> {
		return Promise.resolve({
			authWebUrl: 'https://thewariend.com/auth',
			apiBaseUrl: 'https://api.thewariend.com/api',
			managedAIBaseUrl: 'https://api.thewariend.com/api/cleanslate',
			proCheckoutUrl: 'https://api.thewariend.com/checkout/cleanslate/pro'
		});
	}

	getModelsDevModelMetadata(_provider: AIProvider, _model: string, _token: CancellationToken): Promise<ICleanSlateModelsDevModelMetadata | undefined> {
		return Promise.resolve(undefined);
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
					if (chunk?.choices?.[0]?.finish_reason === 'tool_calls') {
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
			} catch (error) {
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
			} catch (error) {
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
			} catch (error) {
				emitter.fire(`ERROR: ${this.toProviderErrorMessage(error, abort, 'Anthropic')}`);
			} finally {
				abort?.dispose();
				emitter.fire(null);
			}
		})();

		return emitter.event;
	}

	executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
		return this.commandService.executeCommand(options);
	}

	proxyRequest(_options: IRequestOptions, _token: CancellationToken): Promise<ICleanSlateBufferedRequestResponse> {
		return this.unsupported('proxy requests');
	}
	proxyStream(_options: IRequestOptions, _token: CancellationToken): Event<VSBuffer | string | null> {
		return this.unsupportedEvent('proxy streams');
	}
	listGeminiModels(_options: ICleanSlateGeminiListModelsOptions, _token: CancellationToken): Promise<string[]> {
		return this.unsupported('Gemini model listing');
	}
	geminiGenerateContentStream(_options: ICleanSlateGeminiGenerateContentOptions, _token: CancellationToken): Event<VSBuffer | string | null> {
		return this.unsupportedEvent('Gemini streaming');
	}
	listBedrockFoundationModels(_options: ICleanSlateBedrockListModelsOptions, _token: CancellationToken): Promise<string[]> {
		return this.unsupported('Bedrock model listing');
	}
	bedrockConverseStream(_options: ICleanSlateBedrockConverseStreamOptions, _token: CancellationToken): Event<VSBuffer | string | null> {
		return this.unsupportedEvent('Bedrock streaming');
	}
	webSearch(_options: ICleanSlateWebSearchOptions, _token: CancellationToken): Promise<ICleanSlateWebSearchResponse> {
		return this.unsupported('web search');
	}
	webFetch(_options: ICleanSlateWebFetchOptions, _token: CancellationToken): Promise<ICleanSlateWebFetchResponse> {
		return this.unsupported('web fetch');
	}
	localEmbeddings(_options: ICleanSlateLocalEmbeddingOptions, _token: CancellationToken): Promise<ICleanSlateLocalEmbeddingResponse> {
		return this.unsupported('local embeddings');
	}
	executeCommandStream(_options: ICleanSlateCommandExecutionOptions, _token: CancellationToken): Event<ICleanSlateCommandOutputEvent | null> {
		return this.commandService.executeCommandStream(_options, _token);
	}
	startBackgroundCommand(_options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult> {
		return this.commandService.startBackgroundCommand(_options);
	}
	stopBackgroundCommand(_processId: string): Promise<ICleanSlateStopBackgroundCommandResult> {
		return this.commandService.stopBackgroundCommand(_processId);
	}
	getBackgroundCommand(_processId: string): Promise<ICleanSlateBackgroundCommandResult> {
		return this.commandService.getBackgroundCommand(_processId);
	}
	listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]> {
		return this.commandService.listBackgroundCommands();
	}
	browserPlaywright(_request: ICleanSlatePlaywrightBrowserRequest): Promise<unknown> {
		return this.unsupported('integrated browser control');
	}
	loadThreadSession(_sessionId: string): Promise<ICleanSlatePersistedSession | undefined> {
		return Promise.resolve(undefined);
	}
	loadActiveThreadSession(_workspaceId: string): Promise<ICleanSlatePersistedSession | undefined> {
		return Promise.resolve(undefined);
	}
	saveActiveThreadSession(_workspaceId: string, _session: ICleanSlatePersistedSession): Promise<void> {
		return this.unsupported('thread persistence');
	}
	publishThreadSession(_update: ICleanSlateThreadSessionUpdate): Promise<void> {
		return this.unsupported('thread persistence');
	}
	clearActiveThreadSession(_workspaceId: string): Promise<void> {
		return this.unsupported('thread persistence');
	}
	listThreadSessions(): Promise<ICleanSlatePersistedSession[]> {
		return Promise.resolve([]);
	}
	listArchivedThreadSessions(_workspaceId: string): Promise<ICleanSlatePersistedSession[]> {
		return Promise.resolve([]);
	}
	archiveThreadSession(_workspaceId: string, _session: ICleanSlatePersistedSession): Promise<void> {
		return this.unsupported('thread persistence');
	}
	removeThreadSession(_sessionId: string): Promise<void> {
		return this.unsupported('thread persistence');
	}
	removeArchivedThreadSession(_workspaceId: string, _sessionId: string): Promise<void> {
		return this.unsupported('thread persistence');
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
		return new OpenAI({
			apiKey: options.apiKey || (this.isCustomProviderName(options.providerName) ? 'cleanslate-custom-api-key' : ''),
			baseURL,
			defaultHeaders: managed ? { 'User-Agent': 'CleanSlate/1.0' } : undefined,
			...(managed ? { maxRetries: 0 } : {})
		});
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

	private resolveOpenAICompatibleBaseUrl(options: ICleanSlateOpenAICompatibleListModelsOptions): string | undefined {
		if (this.isCleanSlateManagedProviderName(options.providerName)) {
			return `${this.normalizeEnvValue(process.env['CLEANSLATE_API_BASE_URL']) ?? 'https://api.thewariend.com/api'}/cleanslate`;
		}
		const configured = this.normalizeEnvValue(options.baseUrl);
		if (configured) {
			return configured;
		}
		if (this.isNvidiaProviderName(options.providerName)) {
			return this.normalizeEnvValue(process.env['CLEANSLATE_NVIDIA_BASE_URL'])
				|| this.normalizeEnvValue(process.env['NVIDIA_BASE_URL'])
				|| 'https://integrate.api.nvidia.com/v1';
		}
		if (this.isOpenRouterProviderName(options.providerName)) {
			return this.normalizeEnvValue(process.env['CLEANSLATE_OPENROUTER_BASE_URL'])
				|| this.normalizeEnvValue(process.env['OPENROUTER_BASE_URL'])
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
	private normalizeEnvValue(value: string | undefined): string | undefined {
		const trimmed = value?.trim();
		return trimmed ? trimmed.replace(/\/+$/, '') : undefined;
	}

	private async importExternalModule<T>(specifier: string): Promise<T> {
		return import(specifier) as Promise<T>;
	}

	private createProviderAbortController(token: CancellationToken, timeoutMs: number): { signal: AbortSignal; touch: () => void; dispose: () => void; isTimedOut: () => boolean; timeoutMs: number } {
		const controller = new AbortController();
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
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

	private parseToolInput(inputJson: string): any {
		if (!inputJson || inputJson.trim().length === 0) {
			return {};
		}
		try {
			return JSON.parse(inputJson);
		} catch (error) {
			return {
				__cleanSlateArgumentsParseError: `failed to parse function arguments: ${error instanceof Error ? error.message : String(error)}`,
				__cleanSlateRawArguments: inputJson.slice(0, 400)
			};
		}
	}

	private emitProviderPart(emitter: Emitter<VSBuffer | string | null>, part: any): void {
		emitter.fire(`data: ${JSON.stringify(part)}\n\n`);
	}

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
			const closeIdx = state.sawOpen ? -1 : state.pending.indexOf(CLOSE);
			if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
				reasoning += state.pending.slice(0, closeIdx);
				state.pending = state.pending.slice(closeIdx + CLOSE.length);
				state.sawOpen = true;
				continue;
			}
			if (openIdx !== -1) {
				text += state.pending.slice(0, openIdx);
				state.pending = state.pending.slice(openIdx + OPEN.length);
				state.inside = true;
				state.sawOpen = true;
				continue;
			}
			if (state.holdLeading && !state.sawOpen) {
				if (state.pending.length <= LEADING_REASONING_HOLD_CAP_CHARS) {
					break;
				}
				state.holdLeading = false;
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

	private holdPartialTagSuffix(s: string, tag: string): number {
		const max = Math.min(tag.length - 1, s.length);
		for (let k = max; k > 0; k--) {
			if (s.slice(s.length - k) === tag.slice(0, k)) {
				return k;
			}
		}
		return 0;
	}

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

	private unsupported<T>(capability: string): Promise<T> {
		return Promise.reject(new Error(`${capability} is not supported on the Node CLI surface.`));
	}

	private unsupportedEvent<T>(capability: string): Event<T | null> {
		const emitter = new Emitter<T | null>();
		queueMicrotask(() => {
			emitter.fire((`ERROR: ${capability} is not supported on the Node CLI surface.` as unknown) as T);
			emitter.fire(null);
		});
		return emitter.event;
	}
}
