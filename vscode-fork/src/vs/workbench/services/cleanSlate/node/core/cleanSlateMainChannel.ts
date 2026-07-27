/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IServerChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import {
    AIProvider,
    ICleanSlateBackgroundCommandOptions,
    ICleanSlateBedrockConverseStreamOptions,
    ICleanSlateBedrockListModelsOptions,
    ICleanSlateBufferedRequestResponse,
    ICleanSlateAnthropicListModelsOptions,
    ICleanSlateAnthropicMessagesOptions,
    ICleanSlateCommandExecutionOptions,
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
    ICleanSlatePlaywrightBrowserRequest,
    ICleanSlatePersistedSession,
    ICleanSlateRuntimeConfig,
    ICleanSlateThreadSessionUpdate,
    ICleanSlateWebFetchOptions,
    ICleanSlateWebFetchResponse,
    ICleanSlateWebSearchOptions,
    ICleanSlateWebSearchResponse
} from '../../common/core/cleanSlateAI.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

export class CleanSlateMainChannel implements IServerChannel {
	private readonly activeStreams = new Map<string, CancellationTokenSource>();

    constructor(private readonly service: ICleanSlateMainService) { }

    listen<T>(_: unknown, event: string, arg?: any): Event<T> {
        switch (event) {
            case 'proxyStream':
                return this.listenCancellable(arg, token => this.service.proxyStream(arg[0], token)) as unknown as Event<T>;
            case 'openAICompatibleChatStream':
                return this.listenCancellable(arg, token => this.service.openAICompatibleChatStream(arg[0], token)) as unknown as Event<T>;
            case 'openAIResponsesStream':
                return this.listenCancellable(arg, token => this.service.openAIResponsesStream(arg[0], token)) as unknown as Event<T>;
            case 'anthropicMessagesStream':
                return this.listenCancellable(arg, token => this.service.anthropicMessagesStream(arg[0], token)) as unknown as Event<T>;
            case 'geminiGenerateContentStream':
                return this.listenCancellable(arg, token => this.service.geminiGenerateContentStream(arg[0], token)) as unknown as Event<T>;
            case 'bedrockConverseStream':
                return this.listenCancellable(arg, token => this.service.bedrockConverseStream(arg[0], token)) as unknown as Event<T>;
            case 'executeCommandStream':
                return this.listenCancellable(arg, token => this.service.executeCommandStream(arg[0], token)) as unknown as Event<T>;
            case 'onDidPublishThreadSession':
                return this.service.onDidPublishThreadSession as unknown as Event<T>;
        }

        throw new Error(`Event not found: ${event}`);
    }

    call(_: unknown, command: string, arg?: any, token: CancellationToken = CancellationToken.None): Promise<any> {
        switch (command) {
			case 'getRuntimeConfig':
				return this.service.getRuntimeConfig();
			case 'cancelStream':
				this.cancelStream(arg[0]);
				return Promise.resolve();
            case 'proxyRequest':
                return this.service.proxyRequest(arg[0], token);
            case 'getModelsDevModelMetadata':
                return this.service.getModelsDevModelMetadata(arg[0], arg[1], token);
            case 'listOpenAICompatibleModels':
                return this.service.listOpenAICompatibleModels(arg[0], token);
            case 'listAnthropicModels':
                return this.service.listAnthropicModels(arg[0], token);
            case 'listGeminiModels':
                return this.service.listGeminiModels(arg[0], token);
            case 'listBedrockFoundationModels':
                return this.service.listBedrockFoundationModels(arg[0], token);
            case 'webSearch':
                return this.service.webSearch(arg[0], token);
            case 'webFetch':
                return this.service.webFetch(arg[0], token);
            case 'localEmbeddings':
                return this.service.localEmbeddings(arg[0], token);
            case 'executeCommand':
                return this.service.executeCommand(arg[0]);
            case 'startBackgroundCommand':
                return this.service.startBackgroundCommand(arg[0]);
            case 'stopBackgroundCommand':
                return this.service.stopBackgroundCommand(arg[0]);
            case 'getBackgroundCommand':
                return this.service.getBackgroundCommand(arg[0]);
            case 'listBackgroundCommands':
                return this.service.listBackgroundCommands();
            case 'browserPlaywright':
                return this.service.browserPlaywright(arg[0]);
			case 'loadThreadSession':
				return this.service.loadThreadSession(arg[0]);
			case 'loadActiveThreadSession':
				return this.service.loadActiveThreadSession(arg[0]);
			case 'saveActiveThreadSession':
				return this.service.saveActiveThreadSession(arg[0], arg[1]);
            case 'publishThreadSession':
                return this.service.publishThreadSession(arg[0]);
            case 'clearActiveThreadSession':
                return this.service.clearActiveThreadSession(arg[0]);
            case 'listThreadSessions':
                return this.service.listThreadSessions();
            case 'listArchivedThreadSessions':
                return this.service.listArchivedThreadSessions(arg[0]);
            case 'archiveThreadSession':
                return this.service.archiveThreadSession(arg[0], arg[1]);
            case 'removeThreadSession':
                return this.service.removeThreadSession(arg[0]);
            case 'removeArchivedThreadSession':
                return this.service.removeArchivedThreadSession(arg[0], arg[1]);
        }

        throw new Error(`Call not found: ${command}`);
    }

	private listenCancellable<T>(arg: any, createEvent: (token: CancellationToken) => Event<T>): Event<T> {
		const requestId = typeof arg?.[1] === 'string' ? arg[1] : undefined;
		if (!requestId) {
			return createEvent(CancellationToken.None);
		}

		this.cancelStream(requestId);
		const source = new CancellationTokenSource();
		this.activeStreams.set(requestId, source);
		const event = createEvent(source.token);
		return (listener, thisArgs, disposables) => {
			const store = new DisposableStore();
			let completed = false;
			const cleanup = (cancel: boolean) => {
				if (completed) {
					return;
				}
				completed = true;
				if (this.activeStreams.get(requestId) === source) {
					this.activeStreams.delete(requestId);
				}
				source.dispose(cancel);
			};
			store.add(event(value => {
				listener.call(thisArgs, value);
				if (value === null) {
					cleanup(false);
				}
			}));
			store.add(toDisposable(() => cleanup(true)));
			if (Array.isArray(disposables)) {
				disposables.push(store);
			} else {
				disposables?.add(store);
			}
			return store;
		};
	}

	private cancelStream(requestId: string): void {
		const source = this.activeStreams.get(requestId);
		if (!source) {
			return;
		}
		this.activeStreams.delete(requestId);
		source.cancel();
	}
}

/**
 * Client implementation for the renderer to talk to NodeCleanSlateMainService.
 */
export class CleanSlateMainChannelClient implements ICleanSlateMainService {
    declare readonly _serviceBrand: undefined;
    readonly onDidPublishThreadSession: Event<ICleanSlateThreadSessionUpdate>;

    constructor(private readonly channel: any) {
        this.onDidPublishThreadSession = this.channel.listen('onDidPublishThreadSession');
    }

    getRuntimeConfig(): Promise<ICleanSlateRuntimeConfig> {
        return this.channel.call('getRuntimeConfig');
    }

    async proxyRequest(options: any, token: CancellationToken): Promise<ICleanSlateBufferedRequestResponse> {
        return this.channel.call('proxyRequest', [options], token);
    }

    proxyStream(options: any, token: CancellationToken): Event<VSBuffer | string | null> {
        return this.listenCancellable('proxyStream', options, token);
    }

    getModelsDevModelMetadata(provider: AIProvider, model: string, token: CancellationToken): Promise<ICleanSlateModelsDevModelMetadata | undefined> {
        return this.channel.call('getModelsDevModelMetadata', [provider, model], token);
    }

    listOpenAICompatibleModels(options: ICleanSlateOpenAICompatibleListModelsOptions, token: CancellationToken): Promise<string[]> {
        return this.channel.call('listOpenAICompatibleModels', [options], token);
    }

    openAICompatibleChatStream(options: ICleanSlateOpenAICompatibleChatOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        return this.listenCancellable('openAICompatibleChatStream', options, token);
    }

    openAIResponsesStream(options: ICleanSlateOpenAIResponsesOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        return this.listenCancellable('openAIResponsesStream', options, token);
    }

    listAnthropicModels(options: ICleanSlateAnthropicListModelsOptions, token: CancellationToken): Promise<string[]> {
        return this.channel.call('listAnthropicModels', [options], token);
    }

    anthropicMessagesStream(options: ICleanSlateAnthropicMessagesOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        return this.listenCancellable('anthropicMessagesStream', options, token);
    }

    listGeminiModels(options: ICleanSlateGeminiListModelsOptions, token: CancellationToken): Promise<string[]> {
        return this.channel.call('listGeminiModels', [options], token);
    }

    geminiGenerateContentStream(options: ICleanSlateGeminiGenerateContentOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        return this.listenCancellable('geminiGenerateContentStream', options, token);
    }

    listBedrockFoundationModels(options: ICleanSlateBedrockListModelsOptions, token: CancellationToken): Promise<string[]> {
        return this.channel.call('listBedrockFoundationModels', [options], token);
    }

    bedrockConverseStream(options: ICleanSlateBedrockConverseStreamOptions, token: CancellationToken): Event<VSBuffer | string | null> {
        return this.listenCancellable('bedrockConverseStream', options, token);
    }

    webSearch(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<ICleanSlateWebSearchResponse> {
        return this.channel.call('webSearch', [options], token);
    }

    webFetch(options: ICleanSlateWebFetchOptions, token: CancellationToken): Promise<ICleanSlateWebFetchResponse> {
        return this.channel.call('webFetch', [options], token);
    }

    localEmbeddings(options: ICleanSlateLocalEmbeddingOptions, token: CancellationToken): Promise<ICleanSlateLocalEmbeddingResponse> {
        return this.channel.call('localEmbeddings', [options], token);
    }

    executeCommand(options: ICleanSlateCommandExecutionOptions) {
        return this.channel.call('executeCommand', [options]);
    }

    executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken) {
        return this.listenCancellable<ICleanSlateCommandOutputEvent | null>('executeCommandStream', options, token);
    }

	private listenCancellable<T>(eventName: string, options: unknown, token: CancellationToken): Event<T> {
		const requestId = generateUuid();
		const remoteEvent = this.channel.listen(eventName, [options, requestId]) as Event<T>;
		return (listener, thisArgs, disposables) => {
			const store = new DisposableStore();
			let completed = false;
			let cancelRequested = false;
			const cancelRemote = () => {
				if (completed || cancelRequested) {
					return;
				}
				cancelRequested = true;
				void Promise.resolve(this.channel.call('cancelStream', [requestId])).then(undefined, () => undefined);
			};
			const cancellationListener = token.onCancellationRequested(cancelRemote);
			store.add(cancellationListener);
			store.add(remoteEvent(value => {
				if (value === null) {
					completed = true;
					cancellationListener.dispose();
				}
				listener.call(thisArgs, value);
			}));
			store.add(toDisposable(cancelRemote));
			if (Array.isArray(disposables)) {
				disposables.push(store);
			} else {
				disposables?.add(store);
			}
			return store;
		};
	}

    startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions) {
        return this.channel.call('startBackgroundCommand', [options]);
    }

    stopBackgroundCommand(processId: string) {
        return this.channel.call('stopBackgroundCommand', [processId]);
    }

    getBackgroundCommand(processId: string) {
        return this.channel.call('getBackgroundCommand', [processId]);
    }

    listBackgroundCommands() {
        return this.channel.call('listBackgroundCommands');
    }

    browserPlaywright(request: ICleanSlatePlaywrightBrowserRequest): Promise<unknown> {
        return this.channel.call('browserPlaywright', [request]);
    }

	loadThreadSession(sessionId: string): Promise<ICleanSlatePersistedSession | undefined> {
		return this.channel.call('loadThreadSession', [sessionId]);
	}

	loadActiveThreadSession(workspaceId: string): Promise<ICleanSlatePersistedSession | undefined> {
		return this.channel.call('loadActiveThreadSession', [workspaceId]);
	}

    saveActiveThreadSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void> {
        return this.channel.call('saveActiveThreadSession', [workspaceId, session]);
    }

    publishThreadSession(update: ICleanSlateThreadSessionUpdate): Promise<void> {
        return this.channel.call('publishThreadSession', [update]);
    }

    clearActiveThreadSession(workspaceId: string): Promise<void> {
        return this.channel.call('clearActiveThreadSession', [workspaceId]);
    }

    listThreadSessions(): Promise<ICleanSlatePersistedSession[]> {
        return this.channel.call('listThreadSessions');
    }

    listArchivedThreadSessions(workspaceId: string): Promise<ICleanSlatePersistedSession[]> {
        return this.channel.call('listArchivedThreadSessions', [workspaceId]);
    }

    archiveThreadSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void> {
        return this.channel.call('archiveThreadSession', [workspaceId, session]);
    }

    removeThreadSession(sessionId: string): Promise<void> {
        return this.channel.call('removeThreadSession', [sessionId]);
    }

    removeArchivedThreadSession(workspaceId: string, sessionId: string): Promise<void> {
        return this.channel.call('removeArchivedThreadSession', [workspaceId, sessionId]);
    }
}
