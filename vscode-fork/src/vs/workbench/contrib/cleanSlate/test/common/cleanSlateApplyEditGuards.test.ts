/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { assessRewriteScope, normalizeApplyEditRequest, validateFreshReplaceRangeAnchors, validateReadBeforeEdit } from '@cleanslate/sdk/tools/ApplyEditTool.js';

suite('CleanSlate apply edit guards', () => {
	test('normalizes the model-facing exact-string edit contract', () => {
		const result = normalizeApplyEditRequest({
			file_path: '/tmp/example.ts',
			old_string: 'const value = 1;',
			new_string: 'const value = 2;'
		}, 'const value = 1;\n');

		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.deepStrictEqual(result.edits, [{
				mode: 'replace_exact',
				originalText: 'const value = 1;',
				replacementText: 'const value = 2;'
			}]);
		}
	});

	test('rejects a non-unique old_string unless replace_all is explicit', () => {
		const content = 'const value = 1;\nconst value = 1;\n';
		const ambiguous = normalizeApplyEditRequest({
			file_path: '/tmp/example.ts',
			old_string: 'const value = 1;',
			new_string: 'const value = 2;'
		}, content);

		assert.strictEqual(ambiguous.ok, false);
		if (!ambiguous.ok) {
			assert.strictEqual(ambiguous.result.code, 'ambiguous_match');
			assert.strictEqual(ambiguous.result.matchCount, 2);
		}

		const replaceAll = normalizeApplyEditRequest({
			file_path: '/tmp/example.ts',
			old_string: 'const value = 1;',
			new_string: 'const value = 2;',
			replace_all: true
		}, content);
		assert.strictEqual(replaceAll.ok, true);
		if (replaceAll.ok) {
			assert.deepStrictEqual(replaceAll.edits, [{
				mode: 'full_file',
				content: 'const value = 2;\nconst value = 2;\n'
			}]);
		}
	});

	test('rejects full-file edits when disk-read content no longer matches the current model', async () => {
		const uri = URI.file('/tmp/cleanslate/shared.ts');
		const context = {
			readFileState: new Map([[uri.toString(), {
				path: uri.fsPath,
				uri: uri.toString(),
				content: 'export const value = 1;\n',
				totalLines: 1,
				isPartialView: false,
				readAt: Date.now()
			}]]),
			fileService: {
				async stat() {
					return { mtime: 1 };
				}
			}
		} as any;

		const result = await validateReadBeforeEdit(uri, 1, {
			path: uri.fsPath,
			edits: [{ mode: 'replace_range', startLine: 1, endLine: 1, replacementText: 'export const value = 3;\n' }]
		}, context, 'export const value = 2;\n');

		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.result.code, 'file_changed');
		}
	});

	test('accepts full-file edits when disk-read content still matches the current model', async () => {
		const uri = URI.file('/tmp/cleanslate/shared.ts');
		const content = 'export const value = 1;\n';
		const context = {
			readFileState: new Map([[uri.toString(), {
				path: uri.fsPath,
				uri: uri.toString(),
				content,
				totalLines: 1,
				isPartialView: false,
				readAt: Date.now()
			}]]),
			fileService: {
				async stat() {
					return { mtime: 1 };
				}
			}
		} as any;

		const result = await validateReadBeforeEdit(uri, 1, {
			path: uri.fsPath,
			edits: [{ mode: 'replace_range', startLine: 1, endLine: 1, originalText: content, replacementText: 'export const value = 2;\n' }]
		}, context, content);

		assert.strictEqual(result.ok, true);
	});

	test('rejects a whole-file write when disk mtime changed despite a matching model version', async () => {
		const uri = URI.file('/tmp/cleanslate/shared.ts');
		const content = 'export const value = 1;\n';
		const context = {
			readFileState: new Map([[uri.toString(), {
				path: uri.fsPath,
				uri: uri.toString(),
				content,
				currentVersionId: 4,
				mtime: 10,
				totalLines: 1,
				isPartialView: false,
				readAt: Date.now()
			}]]),
			fileService: {
				async stat() {
					return { mtime: 11 };
				}
			}
		} as any;

		const result = await validateReadBeforeEdit(uri, 4, {
			path: uri.fsPath,
			edits: [{ mode: 'full_file', content: 'export const value = 2;\n' }]
		}, context, content);

		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.result.code, 'file_changed');
		}
	});

	test('reports every stale or ambiguous range anchor before planning a batch', () => {
		const content = [
			'class TasksScreen {',
			'  const Text("duplicate");',
			'  const Text("current");',
			'  const Text("duplicate");',
			'}'
		].join('\n');
		const readAt = Date.now();
		const result = validateFreshReplaceRangeAnchors('/tmp/tasks_screen.dart', 7, content, [
			{
				mode: 'replace_range',
				startLine: 3,
				endLine: 3,
				originalText: '  const Text("stale");',
				replacementText: '  const Text("updated");'
			},
			{
				mode: 'replace_range',
				startLine: 2,
				endLine: 2,
				originalText: '  const Text("duplicate");',
				replacementText: '  const Text("updated");'
			}
		], {
			path: '/tmp/tasks_screen.dart',
			uri: 'file:///tmp/tasks_screen.dart',
			content,
			currentVersionId: 7,
			mtime: 11,
			totalLines: 5,
			isPartialView: true,
			readAt,
			ranges: [{
				startLine: 1,
				endLine: 5,
				content,
				currentVersionId: 7,
				mtime: 11,
				readAt
			}]
		});

		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.result.code, 'edit_batch_preflight_failed');
			assert.strictEqual(result.result.failures.length, 2);
			assert.strictEqual(result.result.failures[0].code, 'no_match');
			assert.strictEqual(result.result.failures[0].currentContent, '  const Text("current");');
			assert.strictEqual(result.result.failures[1].code, 'ambiguous_match');
			assert.deepStrictEqual(
				result.result.failures[1].candidates.map((candidate: any) => candidate.startLine),
				[2, 4]
			);
		}
	});

	test('accepts an anchored edit after any fresh read of the file', () => {
		const content = ['one', 'two', 'three'].join('\n');
		const readAt = Date.now();
		const result = validateFreshReplaceRangeAnchors('/tmp/example.ts', 3, content, [{
			mode: 'replace_range',
			startLine: 3,
			endLine: 3,
			originalText: 'three',
			replacementText: 'updated'
		}], {
			path: '/tmp/example.ts',
			uri: 'file:///tmp/example.ts',
			content: 'one',
			currentVersionId: 3,
			mtime: 5,
			totalLines: 3,
			isPartialView: true,
			readAt,
			ranges: [{
				startLine: 1,
				endLine: 1,
				content: 'one',
				currentVersionId: 3,
				mtime: 5,
				readAt
			}]
		});

		assert.strictEqual(result.ok, true);
	});

	test('classifies a 365-to-769 line UX rewrite without blocking it', () => {
		const model = createTextModel(
			Array.from({ length: 491 }, (_, index) => `line ${index + 1}`).join('\n'),
			'typescript',
			undefined,
			URI.file('/tmp/ux.ts')
		);
		try {
			const assessment = assessRewriteScope(model, [{
				range: new Range(1, 1, 365, model.getLineMaxColumn(365)),
				text: Array.from({ length: 769 }, (_, index) => `updated ${index + 1}`).join('\n'),
				blockIndex: 0,
				originalTextSnippet: 'line 1',
				strategy: 'replace_range',
				sourceMode: 'replace_symbol'
			}], '/tmp/ux.ts');

			assert.deepStrictEqual({
				classification: assessment.classification,
				replacedLines: assessment.replacedLines,
				addedLines: assessment.addedLines,
				netLineDelta: assessment.netLineDelta,
				replacesMostOfFile: assessment.replacesMostOfFile
			}, {
				classification: 'large_rewrite',
				replacedLines: 365,
				addedLines: 769,
				netLineDelta: 404,
				replacesMostOfFile: true
			});
			assert.match(assessment.message, /replacing 365\/491 line\(s\) with 769/);
		} finally {
			model.dispose();
		}
	});
});
