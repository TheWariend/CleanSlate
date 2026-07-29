/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { resolveBackgroundLanguageFeatureModel } from '@cleanslate/sdk/tools/languageFeatureActivation.js';
import { CleanSlateToolContext } from '@cleanslate/sdk/tools/types.js';

/**
 * Regression guard for the cross-project file "leak": a background LSP warm-up
 * (get_definitions / find_references / read_symbols) for an Agent Manager session
 * scoped to project A must NOT open the file as an editor tab when the IDE has a
 * DIFFERENT project (B) open. `editorService`/`codeEditorService` are global
 * workbench singletons, so an ungated openEditor here surfaced A's files in B.
 */
suite('CleanSlate language-feature reveal gate', () => {

	function buildContext(fileInIdeWorkspace: boolean) {
		let openEditorCalls = 0;
		const context = {
			modelService: {
				// Model never resolves in-memory, forcing the reveal fallback path.
				getModel: () => null
			},
			textFileService: {
				files: { resolve: async () => undefined }
			},
			editorService: {
				openEditor: async () => { openEditorCalls++; return undefined; }
			},
			// isUriInIdeWorkspace consults this: a folder match means "same project as the IDE".
			ideWorkspaceContextService: {
				getWorkspaceFolder: () => (fileInIdeWorkspace ? { uri: URI.file('/workspace') } : undefined)
			}
		} as unknown as CleanSlateToolContext;
		return { context, openEditorCalls: () => openEditorCalls };
	}

	test('cross-project file: LSP warm-up stays headless and opens no editor tab', async () => {
		const { context, openEditorCalls } = buildContext(false);
		await resolveBackgroundLanguageFeatureModel(URI.file('/other-project/app.ts'), context);
		assert.strictEqual(openEditorCalls(), 0, 'must not reveal a cross-project file in the foreground IDE window');
	});

	test('in-project file: reveal fallback is still allowed', async () => {
		const { context, openEditorCalls } = buildContext(true);
		await resolveBackgroundLanguageFeatureModel(URI.file('/workspace/app.ts'), context);
		assert.strictEqual(openEditorCalls(), 1, 'in-workspace files may still fall back to a background editor open');
	});
});
