/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Emitter } from '../core/event.js';
import { CLEANSLATE_CODING_PROFILE, CLEANSLATE_GENERAL_PROFILE } from '../agent/cleanSlateDomainProfile.js';
import { CleanSlateNodeAgentRuntime, createNodeProviderConfiguration } from '../node/cleanSlateNodeAgentRuntime.js';

for (const profile of [CLEANSLATE_GENERAL_PROFILE, CLEANSLATE_CODING_PROFILE]) {
test(`${profile.id} file creation only runs verification tools defined by its profile`, async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'cleanslate-general-verification-'));
	const runtime = new CleanSlateNodeAgentRuntime({
		rootPath: root,
		workspaceStorageHome: path.join(root, '.private'),
		domainProfile: profile,
		approveTool: async () => true,
		configuration: createNodeProviderConfiguration({ provider: 'openai', model: 'gpt-4o', apiKey: 'test' })
	});
	let requests = 0;
	(runtime as any).mainService.openAICompatibleChatStream = () => {
		assert.ok(++requests <= 2, 'a successful creation must not trigger verification recovery turns');
		const emitter = new Emitter<any>();
		setTimeout(() => {
			if (requests === 1) {
				emitter.fire(`data: ${JSON.stringify({ type: 'tool_call', call: {
					id: 'call-write', toolName: 'write_file', input: { file_path: path.join(root, 'index.html'), content: '<html></html>\n', open: false }
				} })}\n\n`);
			} else emitter.fire('data: {"type":"text","content":"Game created.","phase":"final_answer"}\n\n');
			emitter.fire(null);
		}, 0);
		return emitter.event;
	};
	try {
		const parts: any[] = [];
		for await (const part of runtime.run('Create index.html containing <html></html>.')) parts.push(part);
		assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<html></html>\n');
		assert.equal(requests, 2);
		assert.equal(parts.some(part => part.type === 'tool_result' && !part.toolName), false);
		assert.equal(parts.some(part => part.type === 'tool_result' && part.toolName === 'read_lints'), profile.id === 'coding');
		assert.equal(parts.some(part => part.type === 'task_complete'), true);
	} finally {
		runtime.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
}
