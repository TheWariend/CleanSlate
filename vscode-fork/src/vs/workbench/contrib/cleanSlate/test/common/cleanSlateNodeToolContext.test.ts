/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from '../../../../../base/common/uri.js';
import { createCleanSlateNodeToolContext } from '../../../../services/cleanSlate/node/agentRuntime/cleanSlateNodeToolContext.js';

function scratchRepo(files: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-node-ctx-'));
	for (const [relative, contents] of Object.entries(files)) {
		const target = path.join(root, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, contents, 'utf8');
	}
	return root;
}

function contextFor(root: string, approve = true): any {
	return createCleanSlateNodeToolContext({
		rootPath: root,
		configuration: { provider: 'test' },
		approveCommand: async () => approve
	});
}

suite('CleanSlateNodeToolContext', () => {

	test('reads a file from disk through the text file service', async () => {
		const root = scratchRepo({ 'src/app.ts': 'export const x = 1;\n' });
		const context = contextFor(root);
		const result = await context.textFileService.read(URI.file(path.join(root, 'src/app.ts')));
		assert.strictEqual(result.value, 'export const x = 1;\n');
	});

	test('serves the same model instance to modelService after a resolve', async () => {
		const root = scratchRepo({ 'a.ts': 'first\n' });
		const context = contextFor(root);
		const uri = URI.file(path.join(root, 'a.ts'));
		await context.textFileService.files.resolve(uri);
		const model = context.modelService.getModel(uri);
		assert.ok(model, 'model should be cached after resolve');
		assert.strictEqual(model.getValue(), 'first\n');
	});

	test('an edit is visible to a later read and persists on save', async () => {
		const root = scratchRepo({ 'a.ts': 'hello world\n' });
		const context = contextFor(root);
		const uri = URI.file(path.join(root, 'a.ts'));

		const model = await context.textFileService.files.resolve(uri);
		model.pushEditOperations(null, [{
			range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 },
			text: 'there'
		}]);

		// The agent re-reads through the service, not the model it holds.
		const reread = await context.textFileService.read(uri);
		assert.strictEqual(reread.value, 'hello there\n');

		await context.textFileService.save(uri);
		assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), 'hello there\n');
	});

	test('lists a directory one level deep', async () => {
		const root = scratchRepo({ 'src/a.ts': '', 'src/nested/b.ts': '' });
		const context = contextFor(root);
		const listing = await context.fileService.resolve(URI.file(path.join(root, 'src')));
		const names = listing.children.map((c: any) => c.name).sort();
		assert.deepStrictEqual(names, ['a.ts', 'nested']);
		assert.strictEqual(listing.children.find((c: any) => c.name === 'nested').isDirectory, true);
	});

	test('treats paths outside the root as outside the workspace', () => {
		const root = scratchRepo({ 'a.ts': '' });
		const context = contextFor(root);
		assert.ok(context.workspaceContextService.getWorkspaceFolder(URI.file(path.join(root, 'a.ts'))));
		assert.strictEqual(
			context.workspaceContextService.getWorkspaceFolder(URI.file('/etc/passwd')),
			undefined
		);
	});

	test('runs a command and captures its output', async () => {
		const root = scratchRepo({});
		const context = contextFor(root);
		const result = await context.commandExecutionService.executeCommand({ command: 'echo cleanslate' });
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.exitCode, 0);
		assert.ok(result.stdout.includes('cleanslate'));
	});

	test('reports a failing command without throwing', async () => {
		const root = scratchRepo({});
		const context = contextFor(root);
		const result = await context.commandExecutionService.executeCommand({ command: 'exit 3' });
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.exitCode, 3);
	});

	test('refuses commands by default when no policy is supplied', async () => {
		const root = scratchRepo({});
		const context = createCleanSlateNodeToolContext({ rootPath: root, configuration: {} });
		assert.strictEqual(await context.requestCommandApproval({ command: 'rm -rf /' }), false);
	});

	test('editor-facing members are inert rather than missing', async () => {
		const root = scratchRepo({});
		const context = contextFor(root);
		assert.strictEqual(context.codeEditorService.getActiveCodeEditor(), null);
		assert.strictEqual(await context.codeEditorService.openCodeEditor(), null);
		assert.deepStrictEqual(context.markerService.read(), []);
	});
});
