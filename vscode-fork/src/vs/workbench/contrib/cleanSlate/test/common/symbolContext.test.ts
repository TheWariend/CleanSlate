/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SymbolKind } from '../../../../../editor/common/languages.js';
import { buildSymbolContext } from '../../browser/tools/symbolContext.js';

function range(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
	return { startLineNumber, startColumn, endLineNumber, endColumn };
}

suite('symbolContext', () => {
	test('builds compressed owner hierarchy ranges for lines', () => {
		const symbolContext = buildSymbolContext([{
			name: 'Demo',
			kind: SymbolKind.Class,
			range: range(1, 1, 5, 2),
			selectionRange: range(1, 7, 1, 11),
			children: [{
				name: 'build',
				kind: SymbolKind.Method,
				range: range(2, 3, 3, 4),
				selectionRange: range(2, 8, 2, 13)
			}]
		}], 5);

		const buildOwner = symbolContext.lineOwnerRanges.find(owner => owner.startLine <= 2 && owner.endLine >= 2);
		assert.deepStrictEqual(buildOwner?.ownerPath, ['Demo', 'build']);
		assert.deepStrictEqual(buildOwner?.ownerKindPath, ['class', 'method']);

		const classOnlyOwner = symbolContext.lineOwnerRanges.find(owner => owner.startLine <= 4 && owner.endLine >= 4);
		assert.deepStrictEqual(classOnlyOwner?.ownerPath, ['Demo']);
		assert.strictEqual(symbolContext.symbols[1]?.pathLabel, 'Demo > build');
	});
});
