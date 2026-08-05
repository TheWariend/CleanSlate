/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createCleanSlateNodeToolContext } from '../node/cleanSlateNodeToolContext.js';
import { writeFileTool } from '../tools/WriteFileTool.js';
import { submitArtifactTool } from '../tools/SubmitArtifactTool.js';

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

test('headless submit_artifact writes a document file and opens it in a viewer', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-artifact-workspace-'));
	const privateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-artifact-private-'));
	const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
	const originalSpawnSync = spawnSync;
	const openedPaths: string[] = [];

	try {
		Object.defineProperty(process, 'platform', { value: 'darwin' });
		const context = createCleanSlateNodeToolContext({
			rootPath: root,
			workspaceStorageHome: privateHome,
			configuration: {}
		});

		await submitArtifactTool.run({
			summary: 'I drafted the plan.',
			content: '# Plan\n\nShip it.',
			path: 'implementation_plan.md',
			artifactType: 'implementation_plan'
		}, context);

		const artifactDir = path.join(privateHome, 'artifacts');
		const savedArtifacts = fs.readdirSync(artifactDir);
		assert.equal(savedArtifacts.length, 1);
		assert.match(savedArtifacts[0], /^artifact-\d+-implementation_plan\.md$/);
		assert.equal(fs.readFileSync(path.join(artifactDir, savedArtifacts[0]), 'utf8'), '# Plan\n\nShip it.');
		assert.equal(fs.existsSync(path.join(root, '.cleanslate', 'artifacts')), false);
	} finally {
		if (originalPlatformDescriptor) {
			Object.defineProperty(process, 'platform', originalPlatformDescriptor);
		}
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(privateHome, { recursive: true, force: true });
		void originalSpawnSync;
		void openedPaths;
	}
});
