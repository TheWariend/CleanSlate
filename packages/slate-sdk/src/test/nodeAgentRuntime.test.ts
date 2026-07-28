/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Emitter } from '../core/event.js';
import { CleanSlateNodeAgentRuntime, createNodeProviderConfiguration } from '../node/cleanSlateNodeAgentRuntime.js';

describe('CleanSlateNodeAgentRuntime', () => {
	test('the Node host refuses commands when no approval policy is supplied', async () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		const context = (runtime as any).headlessRuntime.getToolContext();
		assert.equal(await context.requestCommandApproval({ command: 'echo unsafe' }), false);
		runtime.dispose();
	});

	test('runs the existing agent loop with the complete tool registry', async () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		(runtime as any).mainService.openAICompatibleChatStream = () => {
			const emitter = new Emitter<any>();
			setTimeout(() => {
				emitter.fire('data: {"type":"text","content":"All done."}\n\n');
				emitter.fire(null);
			}, 0);
			return emitter.event;
		};

		const parts: any[] = [];
		for await (const part of runtime.run('Answer without changing files.')) {
			parts.push(part);
		}

		assert.equal(runtime.getAvailableToolCount(), 59);
		assert.equal(parts.some(part => part.type === 'chat_text' && part.content === 'All done.'), true);
		assert.equal(parts.some(part => part.type === 'task_complete'), true);
		runtime.dispose();
	});

	test('keeps native provider history across turns and snapshot restore', async () => {
		const createRuntime = () => new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			sessionId: 'persistent-test',
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		const runtime = createRuntime();
		const requests: any[] = [];
		let response = 'First answer.';
		(runtime as any).mainService.openAICompatibleChatStream = (options: any) => {
			requests.push(options);
			const emitter = new Emitter<any>();
			setTimeout(() => {
				emitter.fire(`data: {"type":"text","content":${JSON.stringify(response)}}\n\n`);
				emitter.fire(null);
			}, 0);
			return emitter.event;
		};

		for await (const _part of runtime.run('First question')) { /* consume */ }
		response = 'Second answer.';
		for await (const _part of runtime.run('Second question')) { /* consume */ }

		assert.equal(requests.length, 2);
		assert.equal(requests[1].messages.some((message: any) =>
			message.role === 'assistant' && JSON.stringify(message.content).includes('First answer.')), true);
		assert.equal(requests[1].messages.some((message: any) =>
			message.role === 'user' && JSON.stringify(message.content).includes('Second question')), true);

		const snapshot = runtime.getSessionSnapshot();
		runtime.dispose();
		const restored = createRuntime();
		restored.restoreSessionSnapshot(snapshot);
		assert.equal(restored.getSessionSnapshot().agent?.messages.length, snapshot.agent?.messages.length);
		assert.equal(restored.getSessionSnapshot().threadHistory.at(-1)?.content, 'Second answer.');
		restored.dispose();
	});
});
