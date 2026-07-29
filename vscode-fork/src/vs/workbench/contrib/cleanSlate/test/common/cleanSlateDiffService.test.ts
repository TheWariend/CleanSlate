/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateDiffService } from '@cleanslate/sdk/services/cleanSlateDiffService.js';

suite('CleanSlateDiffService', () => {
	test('preserves dollar and ampersand characters in computed diff text', () => {
		const edits = CleanSlateDiffService.computeDiff(
			'const pattern = "$&";\nconst next = 1;',
			'const pattern = "$1 & $2";\nconst next = 1;'
		);

		assert.ok(edits.some(edit => edit.text.includes('$1 & $2')));
		assert.ok(edits.every(edit => !edit.text.includes('CLEANSLATE_AMPERSAND_TOKEN')));
		assert.ok(edits.every(edit => !edit.text.includes('CLEANSLATE_DOLLAR_TOKEN')));
	});

	suite('computeUnifiedDiffFromContents', () => {
		test('returns undefined when content is unchanged', () => {
			assert.strictEqual(CleanSlateDiffService.computeUnifiedDiffFromContents('a.ts', 'x\ny', 'x\ny'), undefined);
		});

		test('emits hunks in forward file order with a standard header', () => {
			const before = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
			const after = ['line1', 'CHANGED2', 'line3', 'line4', 'line5'].join('\n');
			const diff = CleanSlateDiffService.computeUnifiedDiffFromContents('a.ts', before, after);
			assert.ok(diff, 'expected a diff');
			assert.ok(diff!.startsWith('--- a.ts\n+++ a.ts\n@@ '), 'expected unified header');
			assert.ok(diff!.includes('\n+CHANGED2\n'), 'expected the added line');
			assert.ok(diff!.includes('\n-line2\n'), 'expected the deleted line');
		});

		test('orders multiple hunks top-to-bottom', () => {
			const before = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
			const afterLines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
			afterLines[2] = 'EARLY_CHANGE';
			afterLines[25] = 'LATE_CHANGE';
			const diff = CleanSlateDiffService.computeUnifiedDiffFromContents('a.ts', before, afterLines.join('\n'));
			assert.ok(diff, 'expected a diff');
			assert.ok(diff!.indexOf('EARLY_CHANGE') < diff!.indexOf('LATE_CHANGE'), 'hunks must be in forward order');
		});

		test('bails out (undefined) when the inputs are too large to diff safely', () => {
			const huge = Array.from({ length: 2100 }, (_, i) => `line${i}`).join('\n');
			const hugeChanged = huge.replace('line0', 'changed0') + '\nextra';
			// 2101 * 2102 > 4,000,000 cells → guarded.
			assert.strictEqual(CleanSlateDiffService.computeUnifiedDiffFromContents('a.ts', huge, hugeChanged), undefined);
		});
	});
});
