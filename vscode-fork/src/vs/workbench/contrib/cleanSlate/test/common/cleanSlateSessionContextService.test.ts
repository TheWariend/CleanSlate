/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { CleanSlateSessionContextService } from '../../browser/chat/providers/cleanSlateChatSessionProvider.js';

suite('CleanSlateSessionContextService', () => {
	test('removes active and open editor context from another project', async () => {
		const oldProjectFile = URI.file('/workspace/flutter/lib/main.dart');
		const activeProjectFile = URI.file('/workspace/calculator/README.md');
		const service = new CleanSlateSessionContextService({
			getContext: async () => ({
				activeFile: {
					uri: oldProjectFile,
					content: '',
					selection: '',
					cursorLine: 1,
					languageId: 'dart'
				},
				openFiles: [
					{ uri: oldProjectFile, languageId: 'dart' },
					{ uri: activeProjectFile, languageId: 'markdown' }
				]
			})
		} as any, {
			isInsideWorkspace: (resource: URI) => resource.path.startsWith('/workspace/calculator/')
		} as any);

		const context = await service.getContext();

		assert.strictEqual(context.activeFile, undefined);
		assert.deepStrictEqual(context.openFiles.map(file => file.uri.toString()), [activeProjectFile.toString()]);
	});

	test('retains editor context from the session workspace', async () => {
		const activeProjectFile = URI.file('/workspace/calculator/src/index.ts');
		const service = new CleanSlateSessionContextService({
			getContext: async () => ({
				activeFile: {
					uri: activeProjectFile,
					content: '',
					selection: 'calculate()',
					cursorLine: 4,
					languageId: 'typescript'
				},
				openFiles: []
			})
		} as any, {
			isInsideWorkspace: (resource: URI) => resource.path.startsWith('/workspace/calculator/')
		} as any);

		const context = await service.getContext();

		assert.strictEqual(context.activeFile?.uri.toString(), activeProjectFile.toString());
		assert.strictEqual(context.activeFile?.languageId, 'typescript');
	});
});
