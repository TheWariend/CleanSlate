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
import { grepSearchTool } from '../tools/GrepSearchTool.js';
import { searchWorkspaceTool } from '../tools/SearchWorkspaceTool.js';

function createWorkspace(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-search-'));
	fs.mkdirSync(path.join(root, 'src'), { recursive: true });
	fs.mkdirSync(path.join(root, 'node_modules', 'ignored'), { recursive: true });
	fs.mkdirSync(path.join(root, '.cleanslate', 'ignored'), { recursive: true });
	fs.writeFileSync(path.join(root, 'src', 'alpha.ts'), 'const AlphaNeedle = true;\nalphaNeedle();\n');
	fs.writeFileSync(path.join(root, 'src', 'beta.ts'), 'const beta = "ALPHANEEDLE";\n');
	fs.writeFileSync(path.join(root, 'node_modules', 'ignored', 'match.js'), 'AlphaNeedle\n');
	fs.writeFileSync(path.join(root, '.cleanslate', 'ignored', 'history.txt'), 'AlphaNeedle\n');
	fs.writeFileSync(path.join(root, 'binary.dat'), Buffer.from([0, 65, 108, 112, 104, 97]));
	return root;
}

test('Node tool context supplies every required native CLI service', () => {
	const root = createWorkspace();
	try {
		const context = createCleanSlateNodeToolContext({ rootPath: root, configuration: {} });
		for (const service of [
			'fileService', 'textFileService', 'modelService', 'workspaceContextService',
			'searchService', 'commandExecutionService', 'browserAutomationService',
			'indexService', 'mcpClientService', 'commandService', 'artifactService'
		]) {
			assert.ok(context[service], `${service} should be available in the Node host`);
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('grep_search uses the native Node adapter with scope, regex, and ignore rules', async () => {
	const root = createWorkspace();
	try {
		const context = createCleanSlateNodeToolContext({ rootPath: root, configuration: {} });
		const insensitive = await grepSearchTool.run({
			query: 'alphaneedle',
			path: 'src'
		}, context);

		assert.equal(insensitive.length, 2);
		assert.deepEqual(insensitive.map((entry: any) => path.basename(entry.path)).sort(), ['alpha.ts', 'beta.ts']);
		assert.deepEqual(insensitive.find((entry: any) => entry.path.endsWith('alpha.ts')).matches.map((match: any) => match.line), [1, 2]);
		assert.equal(insensitive.some((entry: any) => entry.path.includes('node_modules') || entry.path.includes('.cleanslate')), false);

		const regex = await grepSearchTool.run({
			query: '^const AlphaNeedle',
			path: 'src/alpha.ts',
			caseSensitive: true,
			isRegex: true
		}, context);
		assert.equal(regex.length, 1);
		assert.deepEqual(regex[0].matches.map((match: any) => match.line), [1]);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('search_workspace no longer reports a missing search service in the CLI host', async () => {
	const root = createWorkspace();
	try {
		const context = createCleanSlateNodeToolContext({ rootPath: root, configuration: {} });
		const result = await searchWorkspaceTool.run({ query: 'AlphaNeedle', path: 'src' }, context);
		assert.equal(Array.isArray(result), true);
		assert.equal(result.some((entry: any) => entry?.system_warning?.includes('searchService unavailable')), false);
		assert.equal(result.length, 2);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
