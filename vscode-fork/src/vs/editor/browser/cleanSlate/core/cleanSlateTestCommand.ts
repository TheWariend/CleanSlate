/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../editorBrowser.js';
import { EditorAction, registerEditorAction } from '../../editorExtensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IIdentifiedSingleEditOperation } from '../../../common/model.js';
import { EditorContextKeys } from '../../../common/editorContextKeys.js';
import * as nls from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICleanSlateService } from '../../../../workbench/services/cleanSlate/common/core/cleanSlateAI.js';
import { buildPrompt } from '../../../common/cleanSlate/utils/cleanSlateIntents.js';
import { InlineCleanSlateController } from './inlineCleanSlateController.js';

export class CleanSlateTestEditAction extends EditorAction {

	private static _running = false;

	constructor() {
		super({
			id: 'editor.action.cleanSlateTestEdit',
			label: nls.localize2('cleanSlateTestEdit', "CleanSlate: Test Edit"),
			alias: 'CleanSlate: Test Edit',
			precondition: EditorContextKeys.editorTextFocus,
			contextMenuOpts: {
				group: 'navigation',
				order: 1
			}
		});
	}

	public async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (CleanSlateTestEditAction._running) {
			return;
		}

		const notificationService = accessor.get(INotificationService);
		const cleanSlateService = accessor.get<ICleanSlateService>(ICleanSlateService);
		const model = editor.getModel();
		if (!model) {
			return;
		}

		const selections = editor.getSelections();
		if (!selections || selections.length === 0) {
			notificationService.info('Select some text first');
			return;
		}

		const validSelections = selections.filter(s => !s.isEmpty());
		if (validSelections.length === 0) {
			notificationService.info('Select some text first');
			return;
		}

		CleanSlateTestEditAction._running = true;

		try {
			const edits: IIdentifiedSingleEditOperation[] = [];

			for (let i = 0; i < validSelections.length; i++) {
				const sel = validSelections[i];
				const selectedText = model.getValueInRange(sel);

				const prompt = buildPrompt('rewrite', selectedText);
				const aiStream = await cleanSlateService.generate(prompt);
				let aiOutput = '';
				for await (const chunk of aiStream) {
					aiOutput += chunk;
				}

				let cleanedOutput = aiOutput.trim();
				const cleanedInput = selectedText.trim();

				// Preserve trailing newline if original had it
				if (selectedText.endsWith('\n') && !cleanedOutput.endsWith('\n')) {
					cleanedOutput += '\n';
				}

				if (!cleanedOutput || cleanedOutput === cleanedInput) {
					continue;
				}

				edits.push({
					identifier: { major: 1, minor: i },
					range: sel,
					text: cleanedOutput,
					forceMoveMarkers: true
				});
			}

			if (edits.length === 0) {
				notificationService.info('No changes needed');
				return;
			}

			const controller = InlineCleanSlateController.get(editor);
			controller?.show(edits, 'rewrite'); // Default to 'rewrite' as the initial instruction

		} catch (err) {
			console.error(err);
			notificationService.error('CleanSlate edit failed');
		} finally {
			CleanSlateTestEditAction._running = false;
		}
	}
}

registerEditorAction(CleanSlateTestEditAction);

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'editor.action.cleanSlateTestEdit',
		title: nls.localize('cleanSlateTestEditPalette', "CleanSlate: Test Edit")
	}
});
