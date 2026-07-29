/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { CleanSlateNodeTextModel } from '@cleanslate/sdk/node/cleanSlateNodeTextModel.js';

function model(text: string): CleanSlateNodeTextModel {
	return new CleanSlateNodeTextModel(URI.file('/tmp/example.ts'), text, 'typescript');
}

suite('CleanSlateNodeTextModel', () => {

	test('counts lines the way the editor does, including a trailing newline', () => {
		assert.strictEqual(model('a\nb\nc').getLineCount(), 3);
		// A trailing newline opens an empty final line.
		assert.strictEqual(model('a\nb\n').getLineCount(), 3);
		assert.strictEqual(model('').getLineCount(), 1);
	});

	test('reads line content without its line ending', () => {
		const m = model('first\nsecond\nthird');
		assert.strictEqual(m.getLineContent(1), 'first');
		assert.strictEqual(m.getLineContent(2), 'second');
		assert.strictEqual(m.getLineContent(3), 'third');
	});

	test('strips the carriage return of a CRLF pair', () => {
		const m = model('first\r\nsecond');
		assert.strictEqual(m.getLineContent(1), 'first');
		assert.strictEqual(m.getLineMaxColumn(1), 6);
	});

	test('round-trips offsets and positions', () => {
		const m = model('abc\ndefgh\nij');
		for (let offset = 0; offset <= m.getValue().length; offset++) {
			const position = m.getPositionAt(offset);
			assert.strictEqual(m.getOffsetAt(position), offset, `offset ${offset}`);
		}
	});

	test('places the caret after the last character of a line', () => {
		const m = model('abc\ndef');
		// Column 4 on a 3-character line is the position after "abc".
		assert.strictEqual(m.getOffsetAt({ lineNumber: 1, column: 4 }), 3);
		assert.strictEqual(m.getLineMaxColumn(1), 4);
	});

	test('extracts a range spanning multiple lines', () => {
		const m = model('alpha\nbeta\ngamma');
		const text = m.getValueInRange({ startLineNumber: 1, startColumn: 3, endLineNumber: 2, endColumn: 3 });
		assert.strictEqual(text, 'pha\nbe');
	});

	test('applies a single edit and bumps the version', () => {
		const m = model('hello world');
		const before = m.getVersionId();
		m.pushEditOperations(null, [{
			range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 },
			text: 'there'
		}]);
		assert.strictEqual(m.getValue(), 'hello there');
		assert.strictEqual(m.getVersionId(), before + 1);
	});

	test('applies several edits without earlier ones shifting later offsets', () => {
		const m = model('one two three');
		m.pushEditOperations(null, [
			{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 }, text: 'ONE' },
			{ range: { startLineNumber: 1, startColumn: 9, endLineNumber: 1, endColumn: 14 }, text: 'THREE' }
		]);
		assert.strictEqual(m.getValue(), 'ONE two THREE');
	});

	test('re-indexes lines after an edit changes the line count', () => {
		const m = model('a\nb');
		m.pushEditOperations(null, [{
			range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 },
			text: '\ninserted'
		}]);
		assert.strictEqual(m.getLineCount(), 3);
		assert.strictEqual(m.getLineContent(2), 'inserted');
	});

	test('leaves the version alone when an edit changes nothing', () => {
		const m = model('unchanged');
		const before = m.getVersionId();
		m.pushEditOperations(null, [{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
			text: ''
		}]);
		assert.strictEqual(m.getVersionId(), before);
	});
});
