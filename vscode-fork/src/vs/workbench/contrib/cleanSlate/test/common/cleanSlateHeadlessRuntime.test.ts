/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CleanSlateHeadlessRuntime } from '../../../../services/cleanSlate/node/agentRuntime/cleanSlateHeadlessRunner.js';
import { readFileTool } from '../../browser/tools/ReadFileTool.js';
import { applyEditTool } from '../../browser/tools/ApplyEditTool.js';

function scratchRepo(files: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-headless-'));
	for (const [relative, contents] of Object.entries(files)) {
		const target = path.join(root, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, contents, 'utf8');
	}
	return root;
}

function runtimeFor(root: string, tools: any[]): CleanSlateHeadlessRuntime {
	return new CleanSlateHeadlessRuntime({
		rootPath: root,
		configuration: { provider: 'test' },
		approveCommand: async () => true,
		tools,
		cleanSlateService: { chat: async () => (async function* () { })() }
	});
}

async function collect(iterable: AsyncIterable<any>): Promise<any[]> {
	const parts: any[] = [];
	for await (const part of iterable) {
		parts.push(part);
	}
	return parts;
}

suite('CleanSlateHeadlessRuntime', () => {

	test('runs the real read_file tool against a real file', async () => {
		const root = scratchRepo({ 'src/app.ts': 'export const answer = 42;\n' });
		const runtime = runtimeFor(root, [readFileTool]);

		const parts = await collect(runtime.executeTool('read_file', {
			path: path.join(root, 'src/app.ts')
		}));

		const result = parts.find(p => p.type === 'tool_result')?.result;
		assert.ok(result, 'expected a tool result');
		assert.notStrictEqual(result.success, false, `read_file failed: ${result.error ?? result.message}`);
		assert.ok(
			JSON.stringify(result).includes('answer = 42'),
			'file contents should reach the model'
		);
	});

	test('a failing tool becomes a result the loop can hand back, not a throw', async () => {
		const root = scratchRepo({});
		const exploding = {
			name: 'explode',
			description: 'always throws',
			run: async () => { throw new Error('boom'); }
		};
		const runtime = runtimeFor(root, [exploding]);

		const parts = await collect(runtime.executeTool('explode', {}));
		const result = parts.find(p => p.type === 'tool_result')?.result;
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.error, 'boom');
	});

	test('reports an unknown tool rather than failing the run', async () => {
		const runtime = runtimeFor(scratchRepo({}), []);
		const parts = await collect(runtime.executeTool('not_a_tool', {}));
		const result = parts.find(p => p.type === 'tool_result')?.result;
		assert.strictEqual(result.success, false);
		assert.ok(result.error.includes('Unknown tool'));
	});

	test('exposes tool categories so the loop can classify calls', () => {
		const runtime = runtimeFor(scratchRepo({}), [readFileTool, applyEditTool]);
		assert.strictEqual(runtime.getToolCategory('apply_edit'), 'edit');
		assert.strictEqual(runtime.getToolCategory('missing'), undefined);
	});

	test('records which files a run touched', async () => {
		const root = scratchRepo({ 'a.ts': 'const a = 1;\n' });
		const runtime = runtimeFor(root, [readFileTool]);
		const target = path.join(root, 'a.ts');

		await collect(runtime.executeTool('read_file', { path: target }));

		const result = runtime.getResult();
		assert.strictEqual(result.toolCalls.length, 1);
		assert.strictEqual(result.toolCalls[0].toolName, 'read_file');
		assert.deepStrictEqual(result.filesTouched, [target]);
	});
});
