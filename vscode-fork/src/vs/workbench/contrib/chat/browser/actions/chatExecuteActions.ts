/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatWidget } from '../chat.js';

export interface IVoiceChatExecuteActionContext {
	readonly disableTimeout?: boolean;
}

export interface IChatExecuteActionContext {
	widget?: IChatWidget;
	inputValue?: string;
	voice?: IVoiceChatExecuteActionContext;
}

export const ChatSubmitAction = { ID: 'workbench.action.chat.submit' };
export const ChatSessionPrimaryPickerAction = { ID: 'workbench.action.chat.sessionPrimaryPicker' };
export const OpenDelegationPickerAction = { ID: 'workbench.action.chat.openDelegationPicker' };
export const OpenModelPickerAction = { ID: 'workbench.action.chat.openModelPicker' };
export const OpenModePickerAction = { ID: 'workbench.action.chat.openModePicker' };
export const OpenSessionTargetPickerAction = { ID: 'workbench.action.chat.openSessionTargetPicker' };
export const OpenWorkspacePickerAction = { ID: 'workbench.action.chat.openWorkspacePicker' };
export const CancelChatActionId = 'workbench.action.chat.cancel';
export const ToggleAgentModeActionId = 'workbench.action.chat.toggleAgentMode';

export interface IToggleChatModeArgs {
	widget?: IChatWidget;
	modeId?: string;
	sessionResource?: any;
}

export class CancelAction {
	static readonly ID = CancelChatActionId;
}

export function registerChatExecuteActions() {
}
