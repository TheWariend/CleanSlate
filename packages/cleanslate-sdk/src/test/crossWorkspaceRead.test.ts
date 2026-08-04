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
import { applyEditTool } from '../tools/ApplyEditTool.js';

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

test('write_file returns a structured path_outside_workspace result instead of throwing when the target is genuinely outside the workspace', async () => {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-a-'));
	const otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-project-b-'));
	try {
		const context = createCleanSlateNodeToolContext({
			rootPath: workspaceRoot,
			configuration: {}
		});

		const targetFile = path.join(otherProjectRoot, 'should-not-be-created.txt');
		const result = await writeFileTool.run({ file_path: targetFile, content: 'nope', open: false }, context);

		assert.equal(result?.success, false, `expected a structured failure, got: ${JSON.stringify(result)}`);
		assert.equal(result?.code, 'path_outside_workspace');
		assert.ok(typeof result?.recoveryHint === 'string' && result.recoveryHint.length > 0, 'expected a non-empty recoveryHint');
		assert.match(result?.message ?? '', /outside the workspace/);
		assert.equal(fs.existsSync(targetFile), false, 'the file must never be created outside the active workspace');
	} finally {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		fs.rmSync(otherProjectRoot, { recursive: true, force: true });
	}
});

test('apply_edit accepts an absolute in-workspace path reached through a symlink whose realpath sits in the workspace', async () => {
	// The workspace is created at the *real* directory, but the tool is handed
	// the *symlinked* absolute path — the exact shape that broke path
	// resolution in the reported transcript. The workbench URI-prefix check
	// does not consider the two paths a match; the realpath fallback must.
	const realWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-real-workspace-'));
	const symlinkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-symlink-parent-'));
	const symlinkedWorkspaceRoot = path.join(symlinkParent, 'workspace');
	try {
		fs.symlinkSync(realWorkspaceRoot, symlinkedWorkspaceRoot);

		const realTargetFile = path.join(realWorkspaceRoot, 'note.txt');
		fs.writeFileSync(realTargetFile, 'hello world\n');
		const symlinkedTargetFile = path.join(symlinkedWorkspaceRoot, 'note.txt');

		// Point the workspace at the *real* root; the tool inputs will use the
		// symlinked path form. This asymmetry is what the realpath fallback
		// exists to bridge.
		const context = createCleanSlateNodeToolContext({
			rootPath: realWorkspaceRoot,
			configuration: {}
		});

		// Warm the read state via the symlinked form the way the model would.
		const readResult = await readFileTool.run({ path: symlinkedTargetFile }, context);
		assert.notEqual(readResult.success, false, `expected read to succeed, got: ${JSON.stringify(readResult)}`);

		const editResult = await applyEditTool.run({
			file_path: symlinkedTargetFile,
			old_string: 'hello world\n',
			new_string: 'hello workspace\n'
		}, context);

		assert.notEqual(editResult?.success, false, `expected apply_edit to accept the symlinked absolute path, got: ${JSON.stringify(editResult)}`);
		const onDisk = fs.readFileSync(realTargetFile, 'utf8');
		assert.equal(onDisk, 'hello workspace\n');
	} finally {
		try { fs.unlinkSync(symlinkedWorkspaceRoot); } catch { /* ignore */ }
		fs.rmSync(symlinkParent, { recursive: true, force: true });
		fs.rmSync(realWorkspaceRoot, { recursive: true, force: true });
	}
});

test('apply_edit returns a structured path_outside_workspace result carrying a recoveryHint when refused', async () => {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-workspace-a-'));
	const otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-project-b-'));
	try {
		const outsideFile = path.join(otherProjectRoot, 'reference.ts');
		fs.writeFileSync(outsideFile, 'export const value = 1;\n');

		const context = createCleanSlateNodeToolContext({
			rootPath: workspaceRoot,
			configuration: {}
		});

		const result = await applyEditTool.run({
			file_path: outsideFile,
			old_string: 'export const value = 1;',
			new_string: 'export const value = 2;'
		}, context);

		assert.equal(result?.success, false, `expected apply_edit to refuse the outside path, got: ${JSON.stringify(result)}`);
		assert.equal(result?.code, 'path_outside_workspace');
		assert.ok(typeof result?.recoveryHint === 'string' && result.recoveryHint.length > 0);
		assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'export const value = 1;\n', 'the outside file must remain untouched');
	} finally {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		fs.rmSync(otherProjectRoot, { recursive: true, force: true });
	}
});
