/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, test } from 'node:test';
import { CancellationToken } from '../core/cancellation.js';
import { CleanSlateNodeCommandService } from '../node/cleanSlateNodeCommandService.js';
import { terminateWindowsProcessTree } from '../node/cleanSlateNodeProcessTree.js';
import { executeCommandTool, startBackgroundCommandTool } from '../tools/ExecuteCommandTool.js';

function commandWithDescendant(source: string): string {
	const command = `"${process.execPath}" -e "${source}"`;
	// Keep the shell waiting for a separate child instead of exec'ing the final
	// command. This makes a shell-only kill fail the regression on Unix as well.
	return process.platform === 'win32' ? `${command} & echo shell-finished`
		: `${command} & cleanslate_child=$!; wait "$cleanslate_child"; cleanslate_status=$?; exit "$cleanslate_status"`;
}

function descendantPid(output: string): number {
	const pid = Number(/pid=(\d+)/.exec(output)?.[1]);
	const parent = Number(/parent=(\d+)/.exec(output)?.[1]);
	assert.ok(Number.isInteger(pid) && pid > 0);
	assert.ok(Number.isInteger(parent) && parent > 0);
	assert.notEqual(parent, process.pid, 'Node must be a shell descendant, not the shell leader');
	return pid;
}

async function assertProcessStopped(pid: number): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt++) {
		try { process.kill(pid, 0); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ESRCH') { return; }
			throw error;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	assert.fail(`Command process ${pid} survived termination`);
}

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
				command: `"${process.execPath}" -e "process.stdout.write('hello')"`
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

	test('tracks and stops a background command and its shell child', { timeout: 15_000 }, async () => {
		const service = new CleanSlateNodeCommandService(process.cwd());
		try {
			const result = await service.startBackgroundCommand({
				command: commandWithDescendant("console.log('listening on http://localhost:4567 pid=' + process.pid + ' parent=' + process.ppid); setInterval(() => {}, 1000)"),
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
			const pid = descendantPid(result.output ?? '');
			assert.notEqual(pid, result.pid);
			await assertProcessStopped(pid);
		} finally { service.dispose(); }
	});

	test('a timeout stops the shell child rather than only its parent', { timeout: 15_000 }, async () => {
		const service = new CleanSlateNodeCommandService(process.cwd());
		try {
			const result = await service.executeCommand({
				command: commandWithDescendant("console.log('pid=' + process.pid + ' parent=' + process.ppid); setInterval(() => {}, 1000)"),
				timeoutMs: 1_000
			});
			assert.equal(result.timedOut, true);
			const pid = descendantPid(result.output);
			await assertProcessStopped(pid);
		} finally { service.dispose(); }
	});

	test('a failed stop reports failure and keeps the command available for retry', { timeout: 15_000 }, async () => {
		const service = new CleanSlateNodeCommandService(process.cwd());
		const originalTerminate = (service as any).terminateProcess;
		let processId: string | undefined;
		try {
			const started = await service.startBackgroundCommand({
				command: commandWithDescendant("console.log('ready'); setInterval(() => {}, 1000)"), readyPattern: 'ready'
			});
			processId = started.processId;
			assert.ok(processId);
			(service as any).terminateProcess = async () => false;
			const result = await service.stopBackgroundCommand(processId);
			assert.equal(result.success, false);
			assert.equal(result.stopped, false);
			assert.match(result.error ?? '', /retry/);
			assert.equal((await service.listBackgroundCommands()).length, 1);
		} finally {
			(service as any).terminateProcess = originalTerminate;
			if (processId) { await service.stopBackgroundCommand(processId); }
			service.dispose();
		}
	});

	test('Windows fallback stops real descendants when taskkill fails', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
		const service = new CleanSlateNodeCommandService(process.cwd());
		try {
			const started = await service.startBackgroundCommand({
				command: commandWithDescendant("console.log('ready pid=' + process.pid + ' parent=' + process.ppid); setInterval(() => {}, 1000)"), readyPattern: 'ready'
			});
			assert.ok(started.pid);
			const pid = descendantPid(started.output ?? '');
			const stopped = await terminateWindowsProcessTree(started.pid, (file, args) => {
				if (file.endsWith('taskkill.exe')) { return Promise.resolve(false); }
				return new Promise(resolve => execFile(file, [...args], { timeout: 5_000, windowsHide: true }, error => resolve(!error)));
			});
			assert.equal(stopped, true);
			await assertProcessStopped(pid);
			await assertProcessStopped(started.pid);
		} finally { service.dispose(); }
	});
});

for (const failure of ['exit', 'spawn', 'timeout']) {
	test(`Windows whole-tree fallback handles taskkill ${failure} failure`, async () => {
		const calls: string[] = [];
		const stopped = await terminateWindowsProcessTree(123, async file => {
			calls.push(file);
			if (calls.length === 1) {
				if (failure !== 'exit') { throw new Error(failure); }
				return false;
			}
			return true;
		});
		assert.equal(stopped, true);
		assert.equal(calls.length, 2);
		assert.match(calls[1], /powershell\.exe$/);
	});
}

test('Windows cleanup reports failure when both tree cleanup methods fail', async () => {
	let attempts = 0;
	assert.equal(await terminateWindowsProcessTree(123, async () => { attempts++; return false; }), false);
	assert.equal(attempts, 2);
});
