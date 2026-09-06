/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CancellationToken } from '../core/cancellation.js';
import { CleanSlateNodeCommandService } from '../node/cleanSlateNodeCommandService.js';
import { executeCommandTool, startBackgroundCommandTool } from '../tools/ExecuteCommandTool.js';

for (const tool of [executeCommandTool, startBackgroundCommandTool]) {
	test(`${tool.name} cannot launch after Stop races with approval`, async () => {
		const controller = new AbortController();
		let launches = 0;
		const result = await tool.run({ command: 'echo regression' }, {
			signal: controller.signal,
			workspaceContextService: { getWorkspace: () => ({ folders: [] }) },
			requestCommandApproval: async () => { controller.abort(); return true; },
			commandExecutionService: {
				executeCommand: () => { launches++; },
				startBackgroundCommand: () => { launches++; }
			}
		} as any);
		assert.equal(result.code, 'user_cancelled');
		assert.equal(launches, 0);
	});
}

describe('CleanSlateNodeCommandService', () => {
	test('never spawns a command with an already cancelled token', async () => {
		const service = new CleanSlateNodeCommandService(process.cwd());
		const events: any[] = [];
		await new Promise<void>(resolve => {
			service.executeCommandStream({ command: 'echo must-not-run' }, CancellationToken.Cancelled)(event => {
				events.push(event);
				if (event === null) { resolve(); }
			});
		});
		assert.equal(events.some(event => event?.type === 'started'), false);
		assert.equal(events.some(event => event?.type === 'stdout'), false);
		service.dispose();
	});
	test('streams command output before the final result', async () => {
		const service = new CleanSlateNodeCommandService(process.cwd());
		const events: any[] = await new Promise(resolve => {
			const received: any[] = [];
			const subscription = service.executeCommandStream({
				command: `${process.execPath} -e "process.stdout.write('hello')"`
			}, CancellationToken.None)(event => {
				received.push(event);
				if (event === null) {
					subscription.dispose();
					resolve(received);
				}
			});
		});

		assert.equal(events[0].type, 'started');
		assert.equal(events.some(event => event?.type === 'stdout' && event.chunk === 'hello'), true);
		assert.equal(events.at(-2).type, 'result');
		assert.equal(events.at(-2).result.success, true);
		assert.equal(events.at(-2).result.output, 'hello');
		assert.equal(events.at(-1), null);
	});

	test('tracks and stops a background command', async () => {
		const service = new CleanSlateNodeCommandService(process.cwd());
		const result = await service.startBackgroundCommand({
			command: `${process.execPath} -e "console.log('listening on http://localhost:4567'); setInterval(() => {}, 1000)"`,
			readyPattern: 'listening on',
			startupTimeoutMs: 2_000
		});

		assert.equal(result.success, true);
		assert.equal(result.status, 'ready');
		assert.equal(result.url, 'http://localhost:4567');
		assert.ok(result.processId);
		assert.equal((await service.listBackgroundCommands()).length, 1);
		assert.equal((await service.stopBackgroundCommand(result.processId!)).stopped, true);
		assert.equal((await service.listBackgroundCommands()).length, 0);
	});
});
