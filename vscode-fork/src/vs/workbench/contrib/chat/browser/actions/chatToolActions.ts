/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AcceptToolConfirmationActionId = 'workbench.action.chat.acceptToolConfirmation';
export const SkipToolConfirmationActionId = 'workbench.action.chat.skipToolConfirmation';
export const AcceptToolPostConfirmationActionId = 'workbench.action.chat.acceptToolPostConfirmation';
export const SkipToolPostConfirmationActionId = 'workbench.action.chat.skipToolPostConfirmation';

export interface IToolConfirmationActionContext {
	sessionId?: string;
	toolCallId?: string;
	sessionResource?: any;
}

export function registerChatToolActions(): void {
}
