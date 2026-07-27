/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, IAction2Options } from '../../../../../platform/actions/common/actions.js';

export class ChatEditingShowChangesAction { 
	static readonly ID = 'workbench.action.chat.showChanges';
	static readonly LABEL = 'Show Changes';
}
export class ViewAllSessionChangesAction { static readonly ID = 'workbench.action.chat.viewAllSessionChanges'; }
export class ViewPreviousEditsAction { 
	static readonly ID = 'workbench.action.chat.viewPreviousEdits';
	static readonly Id = 'workbench.action.chat.viewPreviousEdits';
	static readonly Label = 'View Previous Edits';
}

export abstract class EditingSessionAction extends Action2 {
	constructor(desc: IAction2Options) {
		super(desc);
	}
	override run(): void {}
}

export interface EditingSessionActionContext {
	editingSession?: any;
	chatWidget?: any;
}
export function getEditingSessionContext(accessor: any, ...args: any[]): any { return undefined; }
export interface ChatEditingActionContext { }

export function registerChatEditingActions(): void {
}
