/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IReader } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { CleanSlateEditService } from '../../browser/core/cleanSlateEditService.js';

class MockTreeSitterParser {
	private language: { parse(content: string): { rootNode: any; delete(): void } } | undefined;

	setLanguage(language: { parse(content: string): { rootNode: any; delete(): void } }): void {
		this.language = language;
	}

	parse(content: string): { rootNode: any; delete(): void } | undefined {
		return this.language?.parse(content);
	}

	delete(): void {
		// No-op in tests.
	}
}

class MockTreeSitterLibraryService implements ITreeSitterLibraryService {
	readonly _serviceBrand: undefined;

	getParserClass(): Promise<any> {
		return Promise.resolve(MockTreeSitterParser);
	}

	supportsLanguage(_languageId: string, _reader: IReader | undefined): boolean {
		return true;
	}

	getLanguage(_languageId: string, _ignoreSupportsCheck: boolean, _reader: IReader | undefined): any {
		return undefined;
	}

	async getLanguagePromise(_languageId: string): Promise<any> {
		return {
			parse(content: string) {
				if (content.includes('const value = ;')) {
					return createMockTreeSitterTree([{ line: 1, column: 15 }]);
				}
				return createMockTreeSitterTree([]);
			}
		};
	}

	getInjectionQueries(_languageId: string, _reader: IReader | undefined): null {
		return null;
	}

	getHighlightingQueries(_languageId: string, _reader: IReader | undefined): null {
		return null;
	}

	async createQuery(): Promise<any> {
		throw new Error('not implemented in MockTreeSitterLibraryService');
	}
}

function createMockTreeSitterTree(errorLocations: Array<{ line: number; column: number }>): { rootNode: any; delete(): void } {
	const errorNodes = errorLocations.map(location => ({
		type: 'ERROR',
		hasError: true,
		children: [],
		startPosition: {
			row: location.line - 1,
			column: location.column - 1
		}
	}));

	return {
		rootNode: {
			type: 'program',
			hasError: errorNodes.length > 0,
			children: errorNodes,
			startPosition: { row: 0, column: 0 }
		},
		delete(): void {
			// No-op in tests.
		}
	};
}

suite('CleanSlateEditService', () => {
	test('requires drift guard for multi-line range edits in large files', () => {
		const content = [
			'class ZestoPage {',
			...Array.from({ length: 500 }, (_, index) => `  // filler ${index}`),
			'  void buildCard() {}',
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto.dart'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_range',
					startLine: 20,
					endLine: 21,
					replacementText: '  // changed 20\n  // changed 21'
				}]
			});

			assert.strictEqual(plan.ok, false);
			assert.strictEqual(plan.diagnostics[0]?.code, 'range_requires_original_text');
		} finally {
			model.dispose();
		}
	});

	test('accepts a unique exact-string replacement in large code files', () => {
		const content = [
			'class ZestoPage {',
			...Array.from({ length: 500 }, (_, index) => `  // filler ${index}`),
			'  final label = oldValue;',
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto.dart'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_exact',
					originalText: 'oldValue',
					replacementText: 'newValue'
				}]
			});

			assert.strictEqual(plan.ok, true);
			assert.strictEqual(plan.edits[0]?.sourceMode, 'replace_exact');
			assert.strictEqual(plan.edits[0]?.matchCount, 1);
		} finally {
			model.dispose();
		}
	});

	test('does not impose an invented minimum context size on unique exact replacements', () => {
		const target = [
			'  final first = 1;',
			'  final second = 2;',
			'  final third = 3;',
			'  final fourth = 4;',
			'  final fifth = oldValue;'
		];
		const content = [
			'class ZestoPage {',
			...Array.from({ length: 500 }, (_, index) => `  // filler ${index}`),
			...target,
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto.dart'));
		try {
			const fourLinePlan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_exact',
					originalText: target.slice(1).join('\n'),
					replacementText: [
						'  final second = 2;',
						'  final third = 3;',
						'  final fourth = 4;',
						'  final fifth = newValue;'
					].join('\n')
				}]
			});

			assert.strictEqual(fourLinePlan.ok, true);

			const fiveLinePlan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_exact',
					originalText: target.join('\n'),
					replacementText: [
						'  final first = 1;',
						'  final second = 2;',
						'  final third = 3;',
						'  final fourth = 4;',
						'  final fifth = newValue;'
					].join('\n')
				}]
			});

			assert.strictEqual(fiveLinePlan.ok, true);
			assert.strictEqual(fiveLinePlan.edits[0]?.range.startLineNumber, 502);
		} finally {
			model.dispose();
		}
	});

	test('rejects ambiguous replace_exact matches before applying edits', () => {
		const content = [
			'function alpha() {',
			'  return "same";',
			'}',
			'function beta() {',
			'  return "same";',
			'}'
		].join('\n');
		const model = createTextModel(content, 'typescript', undefined, URI.file('/workspace/duplicate.ts'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_exact',
					originalText: '  return "same";',
					replacementText: '  return "updated";'
				}]
			});

			assert.strictEqual(plan.ok, false);
			assert.strictEqual(plan.diagnostics[0]?.code, 'ambiguous_match');
			assert.strictEqual(plan.diagnostics[0]?.matchCount, 2);
		} finally {
			model.dispose();
		}
	});

	test('uses explicit context to disambiguate replace_exact matches', () => {
		const content = [
			'function alpha() {',
			'  return "same";',
			'}',
			'function beta() {',
			'  return "same";',
			'}'
		].join('\n');
		const model = createTextModel(content, 'typescript', undefined, URI.file('/workspace/contextual.ts'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_exact',
					contextBefore: 'function beta() {',
					originalText: '  return "same";',
					replacementText: '  return "updated";'
				}]
			});

			assert.strictEqual(plan.ok, true);
			assert.strictEqual(plan.edits[0]?.range.startLineNumber, 5);
			assert.strictEqual(plan.edits[0]?.matchCount, 1);
			assert.ok((plan.edits[0]?.confidence ?? 0) >= 0.9);
		} finally {
			model.dispose();
		}
	});

	test('allows structurally derived range edits in large code files', () => {
		const content = [
			'class ZestoPage {',
			...Array.from({ length: 500 }, (_, index) => `  // filler ${index}`),
			'  void buildCard() {}',
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto.dart'));
		try {
			const buildCardLine = 502;
			const originalText = '  void buildCard() {}';
			const replacementText = '  void buildCard() { print("hi"); }';
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_range',
					startLine: buildCardLine,
					endLine: buildCardLine,
					structuralOrigin: 'symbol',
					originalText,
					replacementText
				}]
			});

			assert.strictEqual(plan.ok, true);
			assert.strictEqual(plan.edits[0]?.range.startLineNumber, buildCardLine);
			assert.strictEqual(plan.edits[0]?.text, replacementText);
		} finally {
			model.dispose();
		}
	});

	test('allows guarded single-line sub-range edits in large code files', () => {
		const content = [
			'class ZestoPage {',
			...Array.from({ length: 500 }, (_, index) => `  // filler ${index}`),
			'  final label = oldValue;',
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto.dart'));
		try {
			const labelLine = 502;
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_range',
					startLine: labelLine,
					startColumn: 17,
					endLine: labelLine,
					endColumn: 25,
					originalText: 'oldValue',
					replacementText: 'newValue'
				}]
			});

			assert.strictEqual(plan.ok, true);
			assert.strictEqual(plan.edits[0]?.range.startColumn, 17);
			assert.strictEqual(plan.edits[0]?.text, 'newValue');
		} finally {
			model.dispose();
		}
	});

	test('re-syncs stale replace_range coordinates when exact originalText is unique', () => {
		const originalBlock = [
			'  Widget build(BuildContext context) {',
			'    return const Text("old");',
			'  }'
		].join('\n');
		const content = [
			'class ZestoPage {',
			'  void unrelated() {}',
			originalBlock,
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto.dart'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_range',
					startLine: 2,
					endLine: 2,
					originalText: originalBlock,
					replacementText: originalBlock.replace('"old"', '"new"')
				}]
			});

			assert.strictEqual(plan.ok, true);
			assert.strictEqual(plan.edits[0]?.strategy, 'resynced_range');
			assert.strictEqual(plan.edits[0]?.range.startLineNumber, 3);
		} finally {
			model.dispose();
		}
	});

	test('re-syncs replace_range when originalText differs only by leading whitespace', () => {
		const content = [
			'class ZestoPage {',
			'  void unrelated() {}',
			'  Widget build(BuildContext context) {',
			'    return const Text("old");',
			'  }',
			'}'
		].join('\n');
		// Same code the agent means to edit, but authored with different (stale) indentation, which
		// makes an exact match fail. Flexible recovery should still land it uniquely.
		const driftedOriginal = [
			'Widget build(BuildContext context) {',
			'return const Text("old");',
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto-drift.dart'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_range',
					startLine: 2,
					endLine: 2,
					originalText: driftedOriginal,
					replacementText: driftedOriginal.replace('"old"', '"new"')
				}]
			});

			assert.strictEqual(plan.ok, true);
			assert.strictEqual(plan.edits[0]?.strategy, 'resynced_range');
			assert.strictEqual(plan.edits[0]?.range.startLineNumber, 3);
		} finally {
			model.dispose();
		}
	});

	test('reports structurally unbalanced large-file edits without blocking planning', async () => {
		const content = [
			'class ZestoPage {',
			...Array.from({ length: 500 }, (_, index) => `  void method${index}() {}`),
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/zesto.dart'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				expectedVersionId: model.getVersionId(),
				edits: [{
					mode: 'replace_range',
					startLine: model.getLineCount(),
					endLine: model.getLineCount(),
					replacementText: ''
				}]
			});

			assert.strictEqual(plan.ok, true);
			const diagnostic = await CleanSlateEditService.validatePlannedEditsAsync(model, plan.edits);
			assert.strictEqual(diagnostic?.code, 'structural_validation_failed');
		} finally {
			model.dispose();
		}
	});

	test('tree-sitter preview rejects syntax-breaking edits that delimiter scans miss', async () => {
		const model = createTextModel('const value = 1;', 'typescript', undefined, URI.file('/workspace/value.ts'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_exact',
					originalText: 'const value = 1;',
					replacementText: 'const value = ;'
				}]
			});

			assert.strictEqual(plan.ok, true);
			const diagnostic = await CleanSlateEditService.validatePlannedEditsAsync(
				model,
				plan.edits,
				new MockTreeSitterLibraryService()
			);

			assert.strictEqual(diagnostic?.code, 'structural_validation_failed');
			assert.match(diagnostic?.message ?? '', /Tree-sitter preview detected/);
		} finally {
			model.dispose();
		}
	});

	test('tree-sitter preview ignores pre-existing syntax errors when edit does not worsen them', async () => {
		const model = createTextModel('const value = ;', 'typescript', undefined, URI.file('/workspace/value.ts'));
		try {
			const plan = CleanSlateEditService.planEdits(model, {
				edits: [{
					mode: 'replace_exact',
					originalText: 'value',
					replacementText: 'result'
				}]
			});

			assert.strictEqual(plan.ok, true);
			const diagnostic = await CleanSlateEditService.validatePlannedEditsAsync(
				model,
				plan.edits,
				new MockTreeSitterLibraryService()
			);

			assert.strictEqual(diagnostic, undefined);
		} finally {
			model.dispose();
		}
	});
});
