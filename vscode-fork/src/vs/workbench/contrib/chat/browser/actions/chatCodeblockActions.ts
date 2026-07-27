/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, markAsSingleton } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
import { MenuEntryActionViewItem } from '../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { MenuId, MenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { ICodeBlockActionContext, ICodeCompareBlockActionContext } from '../widget/chatContentParts/codeBlockPart.js';


export interface IChatCodeBlockActionContext extends ICodeBlockActionContext {
}

export function isCodeBlockActionContext(thing: unknown): thing is ICodeBlockActionContext {
	return typeof thing === 'object' && thing !== null && 'code' in thing && 'element' in thing;
}

export function isCodeCompareBlockActionContext(thing: unknown): thing is ICodeCompareBlockActionContext {
	return typeof thing === 'object' && thing !== null && 'element' in thing && 'diffEditor' in thing && 'toggleDiffViewMode' in thing;
}


const APPLY_IN_EDITOR_ID = 'workbench.action.chat.applyInEditor';

export class CodeBlockActionRendering extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chat.codeBlockActionRendering';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILabelService labelService: ILabelService,
	) {
		super();

		const disposable = actionViewItemService.register(MenuId.ChatCodeBlock, APPLY_IN_EDITOR_ID, (action, options) => {
			if (!(action instanceof MenuItemAction)) {
				return undefined;
			}
			return instantiationService.createInstance(class extends MenuEntryActionViewItem {
				protected override getTooltip(): string {
					const context = this._context;
					if (isCodeBlockActionContext(context) && context.codemapperUri) {
						const label = labelService.getUriLabel(context.codemapperUri, { relative: true });
						return localize('interactive.applyInEditorWithURL.label', "Apply to {0}", label);
					}
					return super.getTooltip();
				}
				override setActionContext(newContext: unknown): void {
					super.setActionContext(newContext);
					this.updateTooltip();
				}
			}, action, undefined);
		});

		// Reduces flicker a bit on reload/restart
		markAsSingleton(disposable);
	}
}

export function registerChatCodeBlockActions() {
}

export function registerChatCodeCompareBlockActions() {
}
