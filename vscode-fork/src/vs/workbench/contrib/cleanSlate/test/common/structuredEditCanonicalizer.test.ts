/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IReader } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { canonicalizeStructuredEdits } from '@cleanslate/sdk/tools/structuredEditCanonicalizer.js';
import { CleanSlateToolContext } from '@cleanslate/sdk/tools/types.js';

class MockTreeSitterParser {
	private language: { parse(content: string): { rootNode: MockTreeSitterNode; delete(): void } } | undefined;

	setLanguage(language: { parse(content: string): { rootNode: MockTreeSitterNode; delete(): void } }): void {
		this.language = language;
	}

	parse(content: string): { rootNode: MockTreeSitterNode; delete(): void } | undefined {
		return this.language?.parse(content);
	}

	delete(): void {
		// No-op for tests.
	}
}

class MockTreeSitterLibraryService implements ITreeSitterLibraryService {
	readonly _serviceBrand: undefined;

	constructor(private readonly treeFactory: (content: string) => { rootNode: MockTreeSitterNode; delete(): void }) { }

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
		return { parse: this.treeFactory };
	}

	getInjectionQueries(_languageId: string, _reader: IReader | undefined): null {
		return null;
	}

	getHighlightingQueries(_languageId: string, _reader: IReader | undefined): null {
		return null;
	}

	async createQuery(): Promise<any> {
		throw new Error('Not implemented for tests.');
	}
}

class MockTreeSitterNode {
	public parent: MockTreeSitterNode | null = null;
	public readonly startPosition: { row: number; column: number };
	public readonly endPosition: { row: number; column: number };
	public readonly namedChildren: MockTreeSitterNode[];

	constructor(
		public readonly type: string,
		startLine: number,
		endLine: number,
		namedChildren: MockTreeSitterNode[] = []
	) {
		this.startPosition = { row: startLine - 1, column: 0 };
		this.endPosition = { row: endLine - 1, column: 1 };
		this.namedChildren = namedChildren;
		for (const child of this.namedChildren) {
			child.parent = this;
		}
	}

	namedDescendantForPosition(_start: { row: number; column: number }, _end: { row: number; column: number }): MockTreeSitterNode | null {
		return this.namedChildren[0] ?? null;
	}

	descendantForPosition(start: { row: number; column: number }, end: { row: number; column: number }): MockTreeSitterNode | null {
		return this.namedDescendantForPosition(start, end);
	}
}

function createToolContext(treeFactory: (content: string) => { rootNode: MockTreeSitterNode; delete(): void }): CleanSlateToolContext {
	return {
		treeSitterLibraryService: new MockTreeSitterLibraryService(treeFactory)
	} as unknown as CleanSlateToolContext;
}

suite('structuredEditCanonicalizer', () => {
	test('auto-attaches originalText for large-file replace_range edits', async () => {
		const content = [
			'class Demo {',
			...Array.from({ length: 520 }, (_, index) => `  // filler ${index}`),
			'}'
		].join('\n');
		const model = createTextModel(content, 'dart', undefined, URI.file('/workspace/demo.dart'));

		try {
			const result = await canonicalizeStructuredEdits(
				'lib/demo.dart',
				model,
				[{
					mode: 'replace_range',
					startLine: 2,
					endLine: 3,
					replacementText: '  // changed\n  // changed'
				}],
				createToolContext(() => ({
					rootNode: new MockTreeSitterNode('program', 1, model.getLineCount()),
					delete(): void {
						// No-op in tests.
					}
				}))
			);

			assert.strictEqual(result.ok, true);
			if (!result.ok) {
				return;
			}

			const normalizedEdit = result.edits[0];
			assert.strictEqual(typeof normalizedEdit.originalText, 'string');
			assert.strictEqual(normalizedEdit.startColumn, 1);
			assert.strictEqual(normalizedEdit.endColumn, model.getLineMaxColumn(3));
		} finally {
			model.dispose();
		}
	});

	test('does not expand explicit range edits through Tree-sitter', async () => {
		const model = createTextModel(
			'class Demo {\n  void build() {}\n}\n',
			'dart',
			undefined,
			URI.file('/workspace/demo.dart')
		);

		try {
			const classNode = new MockTreeSitterNode('class_declaration', 1, 3);
			const rootNode = new MockTreeSitterNode('program', 1, 3, [classNode]);

			const result = await canonicalizeStructuredEdits(
				'lib/demo.dart',
				model,
				[{
					mode: 'replace_range',
					startLine: 1,
					endLine: 1,
					replacementText: 'class Demo extends StatelessWidget {}'
				}],
				createToolContext(() => ({
					rootNode,
					delete(): void {
						// No-op in tests.
					}
				}))
			);

			assert.strictEqual(result.ok, true);
			if (!result.ok) {
				return;
			}

			const normalizedEdit = result.edits[0];
			assert.strictEqual(normalizedEdit.startLine, 1);
			assert.strictEqual(normalizedEdit.endLine, 1);
			assert.strictEqual(normalizedEdit.originalText, undefined);
		} finally {
			model.dispose();
		}
	});
});
