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
import { readFileTool } from '../tools/ReadFileTool.js';
import { listDirTool } from '../tools/ListDirTool.js';
import { writeFileTool } from '../tools/WriteFileTool.js';
import { grepSearchTool } from '../tools/GrepSearchTool.js';

test('read_file can read a genuine absolute path outside the active workspace (sibling project)', async () => {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-a-'));
	const otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-project-b-'));
	try {
		const otherFile = path.join(otherProjectRoot, 'reference.ts');
		fs.writeFileSync(otherFile, 'export const fromProjectB = 42;\n');

		const context = createCleanSlateNodeToolContext({
			rootPath: workspaceRoot,
			configuration: {}
		});

		const result = await readFileTool.run({ path: otherFile }, context);

		assert.notEqual(result.success, false, `expected a successful read, got: ${JSON.stringify(result)}`);
		assert.equal(result.content, 'export const fromProjectB = 42;\n');
	} finally {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		fs.rmSync(otherProjectRoot, { recursive: true, force: true });
	}
});

test('list_dir can list a genuine absolute path outside the active workspace (sibling project)', async () => {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-a-'));
	const otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-project-b-'));
	try {
		fs.writeFileSync(path.join(otherProjectRoot, 'package.json'), '{}\n');

		const context = createCleanSlateNodeToolContext({
			rootPath: workspaceRoot,
			configuration: {}
		});

		const result = await listDirTool.run({ path: otherProjectRoot }, context);

		assert.ok(Array.isArray(result), `expected an array listing, got: ${JSON.stringify(result)}`);
		assert.ok(result.some((entry: any) => entry.name === 'package.json'));
	} finally {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		fs.rmSync(otherProjectRoot, { recursive: true, force: true });
	}
});

test('a hallucinated root-relative path (e.g. "/README.md") still resolves inside the active workspace, not the real filesystem root', async () => {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-a-'));
	try {
		fs.writeFileSync(path.join(workspaceRoot, 'README.md'), 'workspace readme\n');

		const context = createCleanSlateNodeToolContext({
			rootPath: workspaceRoot,
			configuration: {}
		});

		const result = await readFileTool.run({ path: '/README.md' }, context);

		assert.equal(result.content, 'workspace readme\n');
	} finally {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
	}
});

test('grep_search with an explicit scope outside the active workspace actually crawls that folder', async () => {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-a-'));
	const otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-project-b-'));
	try {
		fs.writeFileSync(path.join(otherProjectRoot, 'needle.ts'), 'const findMeCrossProject = true;\n');
		fs.writeFileSync(path.join(workspaceRoot, 'unrelated.ts'), 'const findMeCrossProject = true;\n');

		const context = createCleanSlateNodeToolContext({
			rootPath: workspaceRoot,
			configuration: {}
		});

		const scoped = await grepSearchTool.run({ query: 'findMeCrossProject', path: otherProjectRoot }, context);

		assert.ok(Array.isArray(scoped), `expected an array of matches, got: ${JSON.stringify(scoped)}`);
		assert.equal(scoped.length, 1, `expected exactly one file match scoped to project B, got: ${JSON.stringify(scoped)}`);
		assert.equal(scoped[0].path, path.join(otherProjectRoot, 'needle.ts'));

		const unscoped = await grepSearchTool.run({ query: 'findMeCrossProject' }, context);
		assert.equal(unscoped.length, 1, `unscoped search should stay limited to the active workspace, got: ${JSON.stringify(unscoped)}`);
		assert.equal(unscoped[0].path, path.join(workspaceRoot, 'unrelated.ts'));
	} finally {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		fs.rmSync(otherProjectRoot, { recursive: true, force: true });
	}
});

test('write_file still refuses to write outside the active workspace (only reads were widened)', async () => {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-a-'));
	const otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-project-b-'));
	try {
		const context = createCleanSlateNodeToolContext({
			rootPath: workspaceRoot,
			configuration: {}
		});

		const targetFile = path.join(otherProjectRoot, 'should-not-be-created.txt');
		await assert.rejects(
			() => writeFileTool.run({ file_path: targetFile, content: 'nope', open: false }, context),
			/outside the workspace/
		);
		assert.equal(fs.existsSync(targetFile), false);
	} finally {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		fs.rmSync(otherProjectRoot, { recursive: true, force: true });
	}
});
