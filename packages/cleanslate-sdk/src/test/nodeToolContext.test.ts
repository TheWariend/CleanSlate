/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createCleanSlateNodeToolContext } from '../node/cleanSlateNodeToolContext.js';
import { writeFileTool } from '../tools/WriteFileTool.js';

test('headless edit history uses private workspace storage instead of the repository', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-'));
	const privateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-private-'));
	try {
		const context = createCleanSlateNodeToolContext({
			rootPath: root,
			workspaceStorageHome: privateHome,
			configuration: {}
		});
		const workspaceId = context.workspaceContextService.getWorkspace().id;

		assert.match(workspaceId, /^node-[a-f0-9]{32}$/);
		assert.equal(workspaceId.includes(root), false);
		assert.equal(context.environmentService.workspaceStorageHome.fsPath, privateHome);

		const result = await writeFileTool.run({
			file_path: path.join(root, 'created.txt'),
			content: 'private history\n',
			open: false
		}, context);

		assert.equal(result.success, true);
		assert.equal(fs.existsSync(path.join(root, '.cleanslate')), false);
		assert.equal(
			fs.existsSync(path.join(privateHome, workspaceId, '.cleanslate', 'file-history', 'manifest.json')),
			true
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(privateHome, { recursive: true, force: true });
	}
});
