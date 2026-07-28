/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../core/range.js';
import { ISlateTextModel } from '../host/textModel.js';
import { CleanSlateStructuredEdit } from '../services/cleanSlateEditService.js';
import { CleanSlateToolContext } from './types.js';
import { resolveSymbolStructuredEdits } from './symbolEditResolver.js';

export async function canonicalizeStructuredEdits(
	path: string,
	model: ISlateTextModel,
	edits: CleanSlateStructuredEdit[],
	context: CleanSlateToolContext
): Promise<{ ok: true; edits: CleanSlateStructuredEdit[] } | { ok: false; failure: any }> {
	console.info('[CleanSlateEdit] exact-string edit contract; structured symbol/range inputs are legacy compatibility only.');
	const symbolResolution = await resolveSymbolStructuredEdits(path, model, edits, context);
	if (!symbolResolution.ok) {
		return symbolResolution;
	}

	const normalizedRangeEdits = await normalizeRangeEditsWithStructure(model, symbolResolution.edits, context);
	console.info(`[CleanSlateEdit] canonicalized ${edits.length} edit(s) into ${normalizedRangeEdits.length} deterministic edit request(s).`);
	return {
		ok: true,
		edits: normalizedRangeEdits
	};
}

async function normalizeRangeEditsWithStructure(
	model: ISlateTextModel,
	edits: CleanSlateStructuredEdit[],
	context: CleanSlateToolContext
): Promise<CleanSlateStructuredEdit[]> {
	void context;
	return edits.map(edit => {
			if (edit.mode !== 'replace_range' || edit.startLine === undefined || edit.endLine === undefined) {
				return edit;
			}

			const normalizedEdit: CleanSlateStructuredEdit = {
				...edit,
				startColumn: edit.startColumn ?? 1,
				endColumn: edit.endColumn ?? model.getLineMaxColumn(edit.endLine)
			};
			const normalizedRange = new Range(
				normalizedEdit.startLine!,
				normalizedEdit.startColumn!,
				normalizedEdit.endLine!,
				normalizedEdit.endColumn!
			);

			if (shouldAutoAttachOriginalText(model, normalizedRange) && typeof normalizedEdit.originalText !== 'string') {
				normalizedEdit.originalText = model.getValueInRange(normalizedRange);
			}

			return normalizedEdit;
		});
}

function shouldAutoAttachOriginalText(model: ISlateTextModel, range: Range): boolean {
	if (model.getLineCount() >= 500) {
		return true;
	}

	return range.endLineNumber > range.startLineNumber;
}
