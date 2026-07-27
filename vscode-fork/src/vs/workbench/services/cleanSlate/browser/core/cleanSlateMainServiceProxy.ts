/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ICleanSlateChannelService } from '../../common/core/cleanSlateChannelService.js';
import {
    AIProvider,
    ICleanSlateBackgroundCommandOptions,
    ICleanSlateBackgroundCommandResult,
    ICleanSlateBedrockConverseStreamOptions,
    ICleanSlateBedrockListModelsOptions,
    ICleanSlateBufferedRequestResponse,
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
import { IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

export class CleanSlateMainServiceProxy extends Disposable implements ICleanSlateMainService {

    readonly _serviceBrand: undefined;
    private readonly channel: IChannel;
    readonly onDidPublishThreadSession: Event<ICleanSlateThreadSessionUpdate>;

    constructor(
        @ICleanSlateChannelService channelService: ICleanSlateChannelService
    ) {
        super();
        this.channel = channelService.getChannel('cleanSlateMain');
        this.onDidPublishThreadSession = this.channel.listen('onDidPublishThreadSession');
    }

    getRuntimeConfig(): Promise<ICleanSlateRuntimeConfig> {
        return this.channel.call('getRuntimeConfig');
    }

    async proxyRequest(options: IRequestOptions, token: CancellationToken): Promise<ICleanSlateBufferedRequestResponse> {
        return this.channel.call('proxyRequest', [options], token);
    }

    proxyStream(options: IRequestOptions, token: CancellationToken): Event<VSBuffer | string | null> {
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

    executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
        return this.channel.call('executeCommand', [options]);
    }

    executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken): Event<ICleanSlateCommandOutputEvent | null> {
        return this.listenCancellable('executeCommandStream', options, token);
    }

	private listenCancellable<T>(eventName: string, options: unknown, token: CancellationToken): Event<T> {
		const requestId = generateUuid();
		const remoteEvent = this.channel.listen<T>(eventName, [options, requestId]);
		return (listener, thisArgs, disposables) => {
			const store = new DisposableStore();
			let completed = false;
			let cancelRequested = false;
			const cancelRemote = () => {
				if (completed || cancelRequested) {
					return;
				}
				cancelRequested = true;
				void this.channel.call('cancelStream', [requestId]).then(undefined, () => undefined);
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

    startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult> {
        return this.channel.call('startBackgroundCommand', [options]);
    }

    stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult> {
        return this.channel.call('stopBackgroundCommand', [processId]);
    }

    getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult> {
        return this.channel.call('getBackgroundCommand', [processId]);
    }

    listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]> {
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
