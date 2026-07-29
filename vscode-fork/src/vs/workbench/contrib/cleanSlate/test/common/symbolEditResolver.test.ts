/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IReader } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { resolveSymbolStructuredEdits } from '@cleanslate/sdk/tools/symbolEditResolver.js';
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
        return {
            parse: this.treeFactory
        };
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
    public readonly namedChildren: MockTreeSitterNode[];
    public readonly startPosition: { row: number; column: number };
    public readonly endPosition: { row: number; column: number };

    constructor(
        public readonly type: string,
        public readonly text: string,
        startLine: number,
        endLine: number,
        private readonly fieldChildren: Record<string, MockTreeSitterNode | null> = {},
        namedChildren: MockTreeSitterNode[] = []
    ) {
        this.namedChildren = namedChildren;
        this.startPosition = { row: startLine - 1, column: 0 };
        this.endPosition = { row: endLine - 1, column: 1 };
    }

    childForFieldName(fieldName: string): MockTreeSitterNode | null {
        return this.fieldChildren[fieldName] ?? null;
    }
}

function createToolContext(treeFactory: (content: string) => { rootNode: MockTreeSitterNode; delete(): void }): CleanSlateToolContext {
    return {
        treeSitterLibraryService: new MockTreeSitterLibraryService(treeFactory)
    } as unknown as CleanSlateToolContext;
}

suite('symbolEditResolver', () => {
    test('falls back to Tree-sitter candidates when language features are unavailable', async () => {
        const model = createTextModel(
            'class Demo {\n  void build() {}\n}\n',
            'dart',
            undefined,
            URI.file('/workspace/demo.dart')
        );

        try {
            const classNameNode = new MockTreeSitterNode('identifier', 'Demo', 1, 1);
            const classNode = new MockTreeSitterNode('class_declaration', 'class Demo {}', 1, 3, { name: classNameNode });
            const rootNode = new MockTreeSitterNode('program', model.getValue(), 1, 3, {}, [classNode]);

            const result = await resolveSymbolStructuredEdits(
                'lib/demo.dart',
                model,
                [{
                    mode: 'replace_symbol',
                    symbolName: 'Demo',
                    replacementText: 'class Demo {}'
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

            const resolvedEdit = result.edits[0];
            assert.strictEqual(resolvedEdit.mode, 'replace_range');
            assert.strictEqual(resolvedEdit.startLine, 1);
            assert.strictEqual(resolvedEdit.endLine, 3);
        } finally {
            model.dispose();
        }
    });

    test('uses replacementText structural kind to disambiguate duplicate Tree-sitter symbol names', async () => {
        const model = createTextModel(
            'class _LuminousHeader {\n  _LuminousHeader();\n}\n',
            'dart',
            undefined,
            URI.file('/workspace/cleanslate_page.dart')
        );

        try {
            const classNameNode = new MockTreeSitterNode('identifier', '_LuminousHeader', 1, 1);
            const constructorNameNode = new MockTreeSitterNode('identifier', '_LuminousHeader', 2, 2);
            const constructorNode = new MockTreeSitterNode('constructor_declaration', '_LuminousHeader();', 2, 2, { name: constructorNameNode });
            const classNode = new MockTreeSitterNode(
                'class_declaration',
                'class _LuminousHeader { ... }',
                1,
                3,
                { name: classNameNode },
                [constructorNode]
            );
            const rootNode = new MockTreeSitterNode('program', model.getValue(), 1, 3, {}, [classNode]);

            const result = await resolveSymbolStructuredEdits(
                'lib/ui/cleanslate_page.dart',
                model,
                [{
                    mode: 'replace_symbol',
                    symbolName: '_LuminousHeader',
                    replacementText: 'class _LuminousHeader extends StatelessWidget {}'
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

            const resolvedEdit = result.edits[0];
            assert.strictEqual(resolvedEdit.startLine, 1);
            assert.strictEqual(resolvedEdit.endLine, 3);
        } finally {
            model.dispose();
        }
    });

    test('rejects ambiguous originalText matches inside a resolved symbol', async () => {
        const model = createTextModel(
            [
                'class Demo {',
                '  void build() {',
                '    print(label);',
                '    print(label);',
                '  }',
                '}'
            ].join('\n'),
            'dart',
            undefined,
            URI.file('/workspace/demo.dart')
        );

        try {
            const classNameNode = new MockTreeSitterNode('identifier', 'Demo', 1, 1);
            const methodNameNode = new MockTreeSitterNode('identifier', 'build', 2, 2);
            const methodNode = new MockTreeSitterNode(
                'method_declaration',
                [
                    '  void build() {',
                    '    print(label);',
                    '    print(label);',
                    '  }'
                ].join('\n'),
                2,
                5,
                { name: methodNameNode }
            );
            const classNode = new MockTreeSitterNode(
                'class_declaration',
                model.getValue(),
                1,
                6,
                { name: classNameNode },
                [methodNode]
            );
            const rootNode = new MockTreeSitterNode('program', model.getValue(), 1, 6, {}, [classNode]);

            const result = await resolveSymbolStructuredEdits(
                'lib/demo.dart',
                model,
                [{
                    mode: 'replace_symbol',
                    symbolName: 'build',
                    originalText: '    print(label);',
                    replacementText: '    print(title);'
                }],
                createToolContext(() => ({
                    rootNode,
                    delete(): void {
                        // No-op in tests.
                    }
                }))
            );

            assert.strictEqual(result.ok, false);
            if (result.ok) {
                return;
            }
            assert.strictEqual(result.failure.code, 'ambiguous_symbol_snippet');
        } finally {
            model.dispose();
        }
    });
});
