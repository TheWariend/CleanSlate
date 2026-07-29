/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { InlineCleanSlateController } from '../../../../../editor/browser/cleanSlate/core/inlineCleanSlateController.js';
import { ICleanSlateEditorDecorationHost, ICleanSlateOriginalEditForDisplay } from '@cleanslate/sdk/tools/cleanSlateHostTypes.js';

/**
 * The editor's implementation of the decoration host: everything here reaches
 * into the inline controller, which needs real editor types. Keeping it in one
 * `browser`-layer file is what lets the tools depend only on the interface.
 */
export class CleanSlateEditorDecorationHost implements ICleanSlateEditorDecorationHost {

	constructor(private readonly codeEditorService: ICodeEditorService) { }

	showPostApply(
		uri: URI,
		edits: readonly any[],
		originalEdits: readonly ICleanSlateOriginalEditForDisplay[],
		beforeContent: string
	): void {
		const editor = this.codeEditorService.getActiveCodeEditor();
		// The file has to be the one on screen; otherwise there is nothing to
		// decorate and the edit simply lands without a diff overlay.
		if (!editor || editor.getModel()?.uri.toString() !== uri.toString()) {
			return;
		}
		InlineCleanSlateController.get(editor)?.showPostApply(
			edits as any,
			originalEdits as any,
			beforeContent
		);
	}

	registerPostApplySession(
		uri: URI,
		edits: readonly any[],
		originalEdits: readonly ICleanSlateOriginalEditForDisplay[],
		beforeContent: string,
		initialInstruction: string = ''
	): void {
		InlineCleanSlateController.registerPostApplySession(
			this.codeEditorService,
			uri,
			edits as any,
			originalEdits as any,
			beforeContent,
			initialInstruction
		);
	}

	undoLastTrackedEdit(uri: URI): boolean {
		return InlineCleanSlateController.undoLastTrackedEdit(this.codeEditorService, uri);
	}
}
