/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IIdentifiedSingleEditOperation, ITextModel } from '../../model.js';
import { EditSources } from '../../textModelEditSource.js';
import { Range } from '../../core/range.js';
import { stringDiff } from '../../../../base/common/diff/diff.js';
import { Selection } from '../../core/selection.js';

export class CleanSlateEditService {
    applyEdits(
        model: ITextModel,
        edits: IIdentifiedSingleEditOperation[]
    ): void {
        model.pushEditOperations(
            null,
            edits,
            () => null,
            undefined,
            EditSources.unknown({ name: 'ai-edit' })
        );
    }

    applyDiffEdits(
        model: ITextModel,
        range: Range,
        originalText: string,
        newText: string
    ): void {
        const diffs = stringDiff(originalText, newText, false);
        const edits: IIdentifiedSingleEditOperation[] = [];

        if (diffs.length === 0) {
            return;
        }

        // Calculate base offset from the range start
        const baseOffset = model.getOffsetAt(range.getStartPosition());

        for (const change of diffs) {
            // Calculate the range in the document for this specific change
            const startOffset = baseOffset + change.originalStart;
            const endOffset = startOffset + change.originalLength;

            const startPos = model.getPositionAt(startOffset);
            const endPos = model.getPositionAt(endOffset);
            const editRange = new Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);

            const newContent = newText.substring(change.modifiedStart, change.modifiedStart + change.modifiedLength);

            edits.push({
                range: editRange,
                text: newContent
            });
        }

        // Apply all diff edits in one go
        if (edits.length > 0) {
            model.pushEditOperations(
                null,
                edits,
                (inverseEditOperations) => {
                    // Preserve cursor state or compute new cursor state if needed
                    // For now, mapping inverse edits to selections is a reasonable default to keep cursor nearby
                    return inverseEditOperations.map(op => {
                        const endPos = op.range.getEndPosition();
                        return new Selection(endPos.lineNumber, endPos.column, endPos.lineNumber, endPos.column);
                    });
                },
                undefined,
                EditSources.unknown({ name: 'ai-diff-edit' })
            );
        }
    }
}
