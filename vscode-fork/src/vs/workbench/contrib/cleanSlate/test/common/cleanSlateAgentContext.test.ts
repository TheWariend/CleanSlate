/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { CleanSlateAgentContextHelper } from '../../browser/agent/cleanSlateAgentContext.js';

suite('CleanSlateAgentContextHelper', () => {
    test('buildPromptContext injects a skeleton instead of full active file content', async () => {
        const activeUri = URI.file('/workspace/src/example.ts');
        const activeContent = [
            "import { value } from './value';",
            '',
            'export class ExampleService {',
            '  public handle(input: string): string {',
            '    const secret = this.computeInternalState(input);',
            '    return secret;',
            '  }',
            '',
            '  private computeInternalState(input: string): string {',
            '    return input.trim();',
            '  }',
            '}'
        ].join('\n');

        const helper = new CleanSlateAgentContextHelper(
            {
                getModel: (uri: URI) => uri.toString() === activeUri.toString()
                    ? {
                        getValue: () => activeContent,
                        getLanguageId: () => 'typescript'
                    }
                    : undefined
            } as any,
            {
                getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace') }] })
            } as any,
            {
                getConfiguration: () => ({ contextWindow: 20480, fileTruncation: 12000 })
            } as any,
            {
                documentSymbolProvider: { all: () => [] },
                referenceProvider: { all: () => [] }
            } as any,
            {
                resolve: async () => ({ children: [{ name: 'src' }] })
            } as any,
            {
                read: () => []
            } as any,
            new Map()
        );

        const promptContext = await helper.buildPromptContext({
            activeFile: {
                uri: activeUri,
                content: '',
                selection: '',
                cursorLine: 0,
                languageId: 'typescript'
            },
            openFiles: []
        });

        assert.strictEqual(promptContext.includes('Active File Skeleton'), true);
        assert.strictEqual(promptContext.includes("import { value } from './value';"), true);
        assert.strictEqual(promptContext.includes('export class ExampleService'), true);
        assert.strictEqual(promptContext.includes('public handle(input: string): string'), true);
        assert.strictEqual(promptContext.includes('const secret = this.computeInternalState(input);'), false);
    });

    test('buildPromptContext respects global context budget for high-context models', async () => {
        const activeUri = URI.file('/workspace/src/large.ts');
        const activeContent = Array.from({ length: 240 }, (_, index) => `export function generatedFunction${index}(value: string): string { return value; }`).join('\n');

        const helper = new CleanSlateAgentContextHelper(
            {
                getModel: (uri: URI) => uri.toString() === activeUri.toString()
                    ? {
                        getValue: () => activeContent,
                        getLanguageId: () => 'typescript'
                    }
                    : undefined
            } as any,
            {
                getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace') }] })
            } as any,
            {
                getConfiguration: () => ({
                    contextWindow: 400000,
                    globalContextBudget: 12000,
                    fileTruncation: 50000
                })
            } as any,
            {
                documentSymbolProvider: { all: () => [] },
                referenceProvider: { all: () => [] }
            } as any,
            {
                resolve: async () => ({ children: [{ name: 'src' }] })
            } as any,
            {
                read: () => []
            } as any,
            new Map()
        );

        const promptContext = await helper.buildPromptContext({
            activeFile: {
                uri: activeUri,
                content: '',
                selection: '',
                cursorLine: 0,
                languageId: 'typescript'
            },
            openFiles: []
        });

        assert.strictEqual(promptContext.includes('[... skeleton budget exhausted; use read_file or read_file_range for more ...]'), true);
        assert.strictEqual(promptContext.includes('generatedFunction239'), false);
    });
});
