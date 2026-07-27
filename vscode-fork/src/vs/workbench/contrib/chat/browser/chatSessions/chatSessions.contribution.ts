/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { LocalChatSessionUri } from '../../common/model/chatUri.js';
import { localChatSessionType } from '../../common/chatSessionsService.js';

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

export const enum ChatSessionPosition {
	Panel = 1,
	Editor = 2,
	Sidebar = 3
}

export interface INewChatSessionOptions {
	type: string;
	position?: ChatSessionPosition;
	displayName?: string;
}

export function getResourceForNewChatSession(options: string | INewChatSessionOptions): URI {
	const sessionType = typeof options === 'string' ? options : options.type;
	if (sessionType !== localChatSessionType) {
		return URI.from({
			scheme: sessionType,
			path: `/untitled-${generateUuid()}`,
		});
	}
	return LocalChatSessionUri.forSession(generateUuid());
}

export class ChatSessionsService implements IChatSessionsService, IDisposable {
	readonly _serviceBrand: undefined;
	readonly onDidChangeItemsProviders = Event.None;
	readonly onDidChangeSessionItems = Event.None;
	readonly onDidChangeAvailability = Event.None;
	readonly onDidChangeInProgress = Event.None;
	readonly onDidChangeContentProviderSchemes = Event.None;
	readonly onDidChangeSessionOptions = Event.None;
	readonly onDidChangeOptionGroups = Event.None;
	readonly onRequestNotifyExtension = Event.None;

	getChatSessionContribution(chatSessionType: string) { return undefined; }
	registerChatSessionItemProvider() { return { dispose: () => { } }; }
	async activateChatSessionItemProvider() { }
	getAllChatSessionContributions() { return []; }
	getIconForSessionType() { return undefined; }
	getWelcomeTitleForSessionType() { return undefined; }
	getWelcomeMessageForSessionType() { return undefined; }
	getInputPlaceholderForSessionType() { return undefined; }
	async getChatSessionItems() { return []; }
	reportInProgress() { }
	getInProgress() { return []; }
	getContentProviderSchemes() { return []; }
	registerChatSessionContentProvider() { return { dispose: () => { } }; }
	async canResolveChatSession() { return false; }
	async getOrCreateChatSession(sessionResource: URI, token: CancellationToken): Promise<any> { throw new Error('Not implemented'); }
	hasAnySessionOptions() { return false; }
	getSessionOption() { return undefined; }
	setSessionOption() { return false; }
	getCapabilitiesForSessionType() { return undefined; }
	getCustomAgentTargetForSessionType() { return undefined; }
	getOptionGroupsForSessionType() { return undefined; }
	setOptionGroupsForSessionType() { }
	async notifySessionOptionsChange() { }
	registerChatModelChangeListeners() { return { dispose: () => { } }; }
	getInProgressSessionDescription() { return undefined; }
	dispose() { }
}

registerSingleton(IChatSessionsService, ChatSessionsService, InstantiationType.Delayed);

export function registerChatSessionsContributions(): void {
}
